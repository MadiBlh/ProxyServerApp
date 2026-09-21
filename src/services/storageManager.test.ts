import fs from 'fs';
import * as storageManager from './storageManager';
import * as settingsManager from './settingsManager';
import * as logManager from './logManager';

jest.mock('fs');
jest.mock('./settingsManager');
jest.mock('./logManager');

describe('Storage Manager (src/services/storageManager.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (settingsManager.getLogsDir as jest.Mock).mockReturnValue('/mock/logs');
    (settingsManager.getHeadersDir as jest.Mock).mockReturnValue('/mock/headers');
    (settingsManager.getArchivesDir as jest.Mock).mockReturnValue('/mock/archives');
    (settingsManager.getSettings as jest.Mock).mockReturnValue({
      logsDir: '/mock/logs',
      headersDir: '/mock/headers',
      archivesDir: '/mock/archives',
      retentionDays: 0,
      retentionAction: 'archive'
    });
  });

  describe('formatBytes', () => {
    it('should format byte numbers into human-readable strings', () => {
      expect(storageManager.formatBytes(0)).toBe('0 B');
      expect(storageManager.formatBytes(-50)).toBe('0 B');
      expect(storageManager.formatBytes(500)).toBe('500 B');
      expect(storageManager.formatBytes(1024)).toBe('1 KB');
      expect(storageManager.formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
      expect(storageManager.formatBytes(1024 * 1024 * 1024 * 4)).toBe('4 GB');
    });
  });

  describe('getDirectorySizeBytes', () => {
    it('should return 0 when directory does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(storageManager.getDirectorySizeBytes('/non/existent')).toBe(0);
    });

    it('should calculate size recursively across files and folders', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockImplementation((dirPath: string) => {
        if (dirPath === '/mock/root') {
          return [
            { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
            { name: 'subdir', isFile: () => false, isDirectory: () => true }
          ];
        }
        if (dirPath.includes('subdir')) {
          return [
            { name: 'file2.txt', isFile: () => true, isDirectory: () => false }
          ];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('file1.txt')) return { size: 100 };
        if (filePath.includes('file2.txt')) return { size: 250 };
        return { size: 0 };
      });

      const size = storageManager.getDirectorySizeBytes('/mock/root');
      expect(size).toBe(350);
    });
  });

  describe('getStorageStats', () => {
    it('should compile complete storage statistics and transaction counts', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (logManager.getAvailableDateFolders as jest.Mock).mockReturnValue(['2026-09-20', '2026-09-19']);

      (fs.readdirSync as jest.Mock).mockImplementation((dirPath: string) => {
        if (dirPath === '/mock/archives') {
          return [{ name: 'App1', isDirectory: () => true, isFile: () => false }];
        }
        if (dirPath.includes('/mock/archives/App1/headers')) {
          return [{ name: '2026-09-18', isDirectory: () => true, isFile: () => false }];
        }
        if (dirPath === '/mock/headers') {
          return ['uuid1_request.json', 'uuid1_response.json'];
        }
        if (dirPath.includes('2026-09-20')) {
          return ['uuid2_request.json', 'uuid2_response.json'];
        }
        if (dirPath.includes('2026-09-19')) {
          return ['uuid3_request.json', 'uuid3_response.json'];
        }
        return [];
      });

      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });

      const stats = storageManager.getStorageStats();
      expect(stats.logsDir).toBe('/mock/logs');
      expect(stats.headersDir).toBe('/mock/headers');
      expect(stats.archivesDir).toBe('/mock/archives');
      expect(stats.activeDatePartitions).toEqual(['2026-09-20', '2026-09-19']);
      expect(stats.archivedDatePartitions).toEqual(['2026-09-18']);
      expect(stats.totalTransactions).toBe(3);
    });
  });

  describe('vacuumEmptyDirectories', () => {
    it('should delete empty subdirectories and leave non-empty directories intact', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (logManager.getAvailableDateFolders as jest.Mock).mockReturnValue(['2026-09-20']);

      (fs.readdirSync as jest.Mock).mockImplementation((dirPath: string, opts?: any) => {
        if (opts && opts.withFileTypes) {
          return [
            { name: '2026-09-10', isDirectory: () => true, isFile: () => false },
            { name: '2026-09-20', isDirectory: () => true, isFile: () => false }
          ];
        }
        if (dirPath.includes('2026-09-10')) {
          return []; // Empty folder
        }
        if (dirPath.includes('2026-09-20')) {
          return ['uuid1_request.json']; // Non-empty
        }
        return [];
      });

      const result = storageManager.vacuumEmptyDirectories();
      expect(result.cleanedDateFolders).toBe(2); // 1 in logs, 1 in headers
      expect(fs.rmdirSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should do nothing when retentionDays is 0 (unlimited)', () => {
      const res = storageManager.applyRetentionPolicy(0, 'archive');
      expect(res.processedPartitions).toEqual([]);
      expect(res.affectedTransactionsCount).toBe(0);
    });

    it('should permanently delete expired partitions when retentionAction is delete', () => {
      (logManager.getAvailableDateFolders as jest.Mock).mockReturnValue(['2026-09-20', '2020-01-01']);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('2020-01-01')) {
          return ['old1_request.json', 'old2_request.json'];
        }
        return [];
      });

      const res = storageManager.applyRetentionPolicy(30, 'delete');
      expect(res.processedPartitions).toEqual(['2020-01-01']);
      expect(res.actionTaken).toBe('delete');
      expect(res.affectedTransactionsCount).toBe(2);
      expect(fs.rmSync).toHaveBeenCalled();
    });

    it('should archive expired partitions when retentionAction is archive', () => {
      (logManager.getAvailableDateFolders as jest.Mock).mockReturnValue(['2026-09-20', '2020-01-01']);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('2020-01-01')) {
          return ['old1_request.json'];
        }
        return [];
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ appId: 'app-1', appName: 'My App' })
      );
      (logManager.archiveLogsForApp as jest.Mock).mockReturnValue({ archived: 1 });

      const res = storageManager.applyRetentionPolicy(30, 'archive');
      expect(res.processedPartitions).toEqual(['2020-01-01']);
      expect(res.actionTaken).toBe('archive');
      expect(logManager.archiveLogsForApp).toHaveBeenCalledWith('app-1', 'My App', { date: '2020-01-01' });
      expect(res.affectedTransactionsCount).toBe(1);
    });
  });
});
