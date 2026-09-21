import fs from 'fs';
import path from 'path';
import * as settingsManager from './settingsManager';
import * as logManager from './logManager';
import { StorageStats, VacuumResult, RetentionAction, RetentionResult } from '../types';

/**
 * Format bytes into human-readable string (B, KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Recursively calculates the total size in bytes of all files within a directory.
 */
export function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let totalSize = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          totalSize += getDirectorySizeBytes(fullPath);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Skip unreadable directory
  }

  return totalSize;
}

/**
 * Retrieves comprehensive disk metrics, directory sizes, transaction counts,
 * and date partition information for the dashboard.
 */
export function getStorageStats(): StorageStats {
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  const archivesDir = settingsManager.getArchivesDir();

  const logsSizeBytes = getDirectorySizeBytes(logsDir);
  const headersSizeBytes = getDirectorySizeBytes(headersDir);
  const archivesSizeBytes = getDirectorySizeBytes(archivesDir);
  const totalSizeBytes = logsSizeBytes + headersSizeBytes + archivesSizeBytes;

  const activeDatePartitions = logManager.getAvailableDateFolders();

  // Count archived date partitions
  const archivedDatePartitionsSet = new Set<string>();
  if (fs.existsSync(archivesDir)) {
    try {
      const appDirs = fs.readdirSync(archivesDir, { withFileTypes: true });
      for (const appDir of appDirs) {
        if (appDir.isDirectory()) {
          const appHeadersDir = path.join(archivesDir, appDir.name, 'headers');
          if (fs.existsSync(appHeadersDir)) {
            const dateDirs = fs.readdirSync(appHeadersDir, { withFileTypes: true });
            for (const d of dateDirs) {
              if (d.isDirectory()) {
                archivedDatePartitionsSet.add(d.name);
              }
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }
  const archivedDatePartitions = Array.from(archivedDatePartitionsSet).sort().reverse();

  // Count active transactions
  let totalTransactions = 0;
  if (fs.existsSync(headersDir)) {
    try {
      // Scan root headers
      const rootFiles = fs.readdirSync(headersDir);
      totalTransactions += rootFiles.filter(f => f.endsWith('_request.json')).length;

      // Scan date partition subfolders
      for (const dateFolder of activeDatePartitions) {
        const p = path.join(headersDir, dateFolder);
        if (fs.existsSync(p)) {
          const partitionFiles = fs.readdirSync(p);
          totalTransactions += partitionFiles.filter(f => f.endsWith('_request.json')).length;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  let freeDiskBytes: number | undefined;
  let totalDiskBytes: number | undefined;

  try {
    if (typeof (fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number; blocks: number } }).statfsSync === 'function') {
      const stats = (fs as unknown as { statfsSync: (p: string) => { bavail: number; bsize: number; blocks: number } }).statfsSync(logsDir);
      freeDiskBytes = stats.bavail * stats.bsize;
      totalDiskBytes = stats.blocks * stats.bsize;
    }
  } catch {
    // Unsupported or permission restricted
  }

  return {
    logsDir,
    headersDir,
    archivesDir,
    logsSizeBytes,
    headersSizeBytes,
    archivesSizeBytes,
    totalSizeBytes,
    formattedTotalSize: formatBytes(totalSizeBytes),
    totalTransactions,
    activeDatePartitions,
    archivedDatePartitions,
    freeDiskBytes,
    totalDiskBytes
  };
}

/**
 * Removes empty date partition subdirectories from logs/ and headers/.
 */
export function vacuumEmptyDirectories(): VacuumResult {
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  let cleanedDateFolders = 0;

  const checkAndCleanEmptyDirs = (baseDir: string) => {
    if (!fs.existsSync(baseDir)) return;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(baseDir, entry.name);
          try {
            const contents = fs.readdirSync(dirPath);
            if (contents.length === 0) {
              fs.rmdirSync(dirPath);
              cleanedDateFolders++;
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Skip
    }
  };

  checkAndCleanEmptyDirs(logsDir);
  checkAndCleanEmptyDirs(headersDir);

  const remainingDateFolders = logManager.getAvailableDateFolders().length;

  return {
    cleanedDateFolders,
    freedBytes: 0,
    remainingDateFolders
  };
}

/**
 * Formats a Date object into 'YYYY-MM-DD'.
 */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Evaluates and applies the retention policy on active log partitions.
 * Moves expired daily partitions to archives or deletes them permanently.
 */
export function applyRetentionPolicy(
  customDays?: number,
  customAction?: RetentionAction
): RetentionResult {
  const settings = settingsManager.getSettings();
  const retentionDays = customDays !== undefined ? customDays : settings.retentionDays;
  const retentionAction = customAction !== undefined ? customAction : settings.retentionAction;

  if (retentionDays <= 0) {
    return {
      processedPartitions: [],
      actionTaken: retentionAction,
      affectedTransactionsCount: 0
    };
  }

  const cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffDateStr = formatDate(new Date(cutoffTimestamp));

  const activeDatePartitions = logManager.getAvailableDateFolders();
  const expiredPartitions = activeDatePartitions.filter(d => d < cutoffDateStr);

  if (expiredPartitions.length === 0) {
    return {
      processedPartitions: [],
      actionTaken: retentionAction,
      affectedTransactionsCount: 0
    };
  }

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  let affectedTransactionsCount = 0;

  for (const dateFolder of expiredPartitions) {
    const partitionHeaderDir = path.join(headersDir, dateFolder);
    const partitionLogDir = path.join(logsDir, dateFolder);

    if (retentionAction === 'delete') {
      // Count transactions before deleting
      if (fs.existsSync(partitionHeaderDir)) {
        try {
          const files = fs.readdirSync(partitionHeaderDir);
          affectedTransactionsCount += files.filter(f => f.endsWith('_request.json')).length;
          fs.rmSync(partitionHeaderDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`[StorageManager] Failed to delete expired headers for ${dateFolder}:`, e);
        }
      }
      if (fs.existsSync(partitionLogDir)) {
        try {
          fs.rmSync(partitionLogDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`[StorageManager] Failed to delete expired logs for ${dateFolder}:`, e);
        }
      }
    } else {
      // Archive mode
      // Find which applications have logs in this partition
      if (fs.existsSync(partitionHeaderDir)) {
        try {
          const files = fs.readdirSync(partitionHeaderDir);
          const appMap = new Map<string, string>(); // appId -> appName

          for (const file of files.filter(f => f.endsWith('_request.json'))) {
            try {
              const meta = JSON.parse(fs.readFileSync(path.join(partitionHeaderDir, file), 'utf8'));
              if (meta.appId) {
                appMap.set(meta.appId, meta.appName || 'unknown');
              }
            } catch {
              // skip unreadable
            }
          }

          for (const [appId, appName] of appMap.entries()) {
            const res = logManager.archiveLogsForApp(appId, appName, { date: dateFolder });
            affectedTransactionsCount += res.archived;
          }
        } catch (e) {
          console.error(`[StorageManager] Failed to auto-archive partition ${dateFolder}:`, e);
        }
      }
    }
  }

  // Vacuum empty directories after retention
  vacuumEmptyDirectories();

  return {
    processedPartitions: expiredPartitions,
    actionTaken: retentionAction,
    affectedTransactionsCount
  };
}
