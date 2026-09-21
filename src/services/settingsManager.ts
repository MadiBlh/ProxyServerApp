import '../utils/bootstrap';
import fs from 'fs';
import path from 'path';
import type { AppSettings, UpdateSettingsInput } from '../types';

/* ==========================================================================
   SETTINGS MANAGER
   Manages storage locations for configurations (applications.json)
   and captured traffic logs/headers/archives, plus retention policies.
   Supports project root defaults, user-customized paths via settings.json,
   and environment variables (PROXY_CONFIG_DIR, PROXY_LOGS_DIR, PROXY_ARCHIVES_DIR).
   ========================================================================== */

const isDist = __dirname.replace(/\\/g, '/').includes('/dist/');
export const PROJECT_ROOT = isDist
  ? path.resolve(__dirname, '../../../')
  : path.resolve(__dirname, '../../');
const SETTINGS_FILE = path.join(PROJECT_ROOT, 'settings.json');

export const DEFAULT_CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
export const DEFAULT_LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
export const DEFAULT_HEADERS_DIR = path.join(PROJECT_ROOT, 'headers');
export const DEFAULT_ARCHIVES_DIR = path.join(PROJECT_ROOT, 'archives');

interface SettingsFileData {
  configDir?: string;
  logsDir?: string;
  archivesDir?: string;
  retentionDays?: number;
  retentionAction?: 'archive' | 'delete';
}

/** Reads local settings from settings.json if present. */
function readSettingsFile(): SettingsFileData {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return (JSON.parse(data) as SettingsFileData) || {};
    } catch (err) {
      console.warn('[SettingsManager] Error reading settings.json:', (err as Error).message);
    }
  }
  return {};
}

/** Writes settings to settings.json. */
function writeSettingsFile(settings: SettingsFileData): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[SettingsManager] Error writing settings.json:', (err as Error).message);
    throw err;
  }
}

/** Returns the effective config directory path. */
export function getConfigDir(): string {
  const envPath = process.env['PROXY_CONFIG_DIR'];
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }
  const saved = readSettingsFile();
  if (saved.configDir && saved.configDir.trim()) {
    return path.resolve(saved.configDir.trim());
  }
  return DEFAULT_CONFIG_DIR;
}

/** Returns the path to applications.json. */
export function getConfigFile(): string {
  return path.join(getConfigDir(), 'applications.json');
}

/** Returns the effective logs directory path (where request/response bodies are saved). */
export function getLogsDir(): string {
  const envPath = process.env['PROXY_LOGS_DIR'];
  if (envPath && envPath.trim()) {
    return path.join(path.resolve(envPath.trim()), 'logs');
  }
  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    return path.join(path.resolve(saved.logsDir.trim()), 'logs');
  }
  return DEFAULT_LOGS_DIR;
}

/** Returns the effective headers directory path (where header JSON files are saved). */
export function getHeadersDir(): string {
  const envPath = process.env['PROXY_LOGS_DIR'];
  if (envPath && envPath.trim()) {
    return path.join(path.resolve(envPath.trim()), 'headers');
  }
  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    return path.join(path.resolve(saved.logsDir.trim()), 'headers');
  }
  return DEFAULT_HEADERS_DIR;
}

/** Returns the effective archives directory path (where archived logs are stored). */
export function getArchivesDir(): string {
  const envArchives = process.env['PROXY_ARCHIVES_DIR'];
  if (envArchives && envArchives.trim()) {
    return path.resolve(envArchives.trim());
  }
  const envLogs = process.env['PROXY_LOGS_DIR'];
  if (envLogs && envLogs.trim()) {
    return path.join(path.resolve(envLogs.trim()), 'archives');
  }
  const saved = readSettingsFile();
  if (saved.archivesDir && saved.archivesDir.trim()) {
    return path.resolve(saved.archivesDir.trim());
  }
  if (saved.logsDir && saved.logsDir.trim()) {
    return path.join(path.resolve(saved.logsDir.trim()), 'archives');
  }
  return DEFAULT_ARCHIVES_DIR;
}

/** Returns the base logs storage directory (parent of logs/ and headers/). */
export function getLogsBaseDir(): string {
  const envPath = process.env['PROXY_LOGS_DIR'];
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }
  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    return path.resolve(saved.logsDir.trim());
  }
  return PROJECT_ROOT;
}

/** Returns a summary of current settings for the dashboard API. */
export function getSettings(): AppSettings {
  const configDir = getConfigDir();
  const logsBaseDir = getLogsBaseDir();
  const logsDir = getLogsDir();
  const headersDir = getHeadersDir();
  const archivesDir = getArchivesDir();

  const isDefaultConfig = path.resolve(configDir) === path.resolve(DEFAULT_CONFIG_DIR);
  const isDefaultLogs = path.resolve(logsBaseDir) === path.resolve(PROJECT_ROOT);
  const isDefaultArchives = path.resolve(archivesDir) === path.resolve(DEFAULT_ARCHIVES_DIR);

  const saved = readSettingsFile();
  const retentionDays = typeof saved.retentionDays === 'number' ? saved.retentionDays : 0;
  const retentionAction = saved.retentionAction === 'delete' ? 'delete' : 'archive';

  return {
    configDir,
    logsBaseDir,
    logsDir,
    headersDir,
    archivesDir,
    isDefaultConfig,
    isDefaultLogs,
    isDefaultArchives,
    retentionDays,
    retentionAction,
    defaults: {
      configDir: DEFAULT_CONFIG_DIR,
      logsBaseDir: PROJECT_ROOT,
      logsDir: DEFAULT_LOGS_DIR,
      headersDir: DEFAULT_HEADERS_DIR,
      archivesDir: DEFAULT_ARCHIVES_DIR,
      retentionDays: 0,
      retentionAction: 'archive'
    }
  };
}

/**
 * Updates settings and ensures directories exist.
 * Optionally copies existing applications.json if migrateExistingConfig is true.
 */
export function updateSettings({
  configDir,
  logsDir,
  archivesDir,
  retentionDays,
  retentionAction,
  migrateExistingConfig = false
}: UpdateSettingsInput): AppSettings {
  const currentConfigFile = getConfigFile();
  const previousConfigDir = getConfigDir();
  const saved = readSettingsFile();

  const newConfigDir =
    configDir !== undefined && configDir.trim()
      ? path.resolve(configDir.trim())
      : configDir === ''
      ? DEFAULT_CONFIG_DIR
      : getConfigDir();

  const newLogsBase =
    logsDir !== undefined && logsDir.trim()
      ? path.resolve(logsDir.trim())
      : logsDir === ''
      ? PROJECT_ROOT
      : getLogsBaseDir();

  const newArchivesDir =
    archivesDir !== undefined && archivesDir.trim()
      ? path.resolve(archivesDir.trim())
      : archivesDir === ''
      ? (newLogsBase === PROJECT_ROOT ? DEFAULT_ARCHIVES_DIR : path.join(newLogsBase, 'archives'))
      : getArchivesDir();

  const newRetentionDays =
    retentionDays !== undefined ? Math.max(0, retentionDays) : saved.retentionDays ?? 0;
  const newRetentionAction =
    retentionAction === 'delete' || retentionAction === 'archive'
      ? retentionAction
      : saved.retentionAction ?? 'archive';

  // Validate and ensure directories can be created
  try {
    if (!fs.existsSync(newConfigDir)) {
      fs.mkdirSync(newConfigDir, { recursive: true });
    }
  } catch (err) {
    throw new Error(
      `Cannot create configuration directory "${newConfigDir}": ${(err as Error).message}`
    );
  }

  try {
    const targetLogs =
      newLogsBase === PROJECT_ROOT ? DEFAULT_LOGS_DIR : path.join(newLogsBase, 'logs');
    const targetHeaders =
      newLogsBase === PROJECT_ROOT ? DEFAULT_HEADERS_DIR : path.join(newLogsBase, 'headers');
    if (!fs.existsSync(targetLogs)) fs.mkdirSync(targetLogs, { recursive: true });
    if (!fs.existsSync(targetHeaders)) fs.mkdirSync(targetHeaders, { recursive: true });
    if (!fs.existsSync(newArchivesDir)) fs.mkdirSync(newArchivesDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Cannot create logs/archives directories: ${(err as Error).message}`
    );
  }

  // Handle optional migration of applications.json
  const targetConfigFile = path.join(newConfigDir, 'applications.json');
  if (migrateExistingConfig && path.resolve(previousConfigDir) !== path.resolve(newConfigDir)) {
    if (fs.existsSync(currentConfigFile)) {
      try {
        const content = fs.readFileSync(currentConfigFile, 'utf8');
        fs.writeFileSync(targetConfigFile, content, 'utf8');
        console.log(`[SettingsManager] Migrated applications.json to "${targetConfigFile}"`);
      } catch (err) {
        console.warn(
          '[SettingsManager] Failed to migrate applications.json:',
          (err as Error).message
        );
      }
    }
  }

  // Save to settings.json
  const settingsToSave: SettingsFileData = {
    configDir: newConfigDir === DEFAULT_CONFIG_DIR ? '' : newConfigDir,
    logsDir: newLogsBase === PROJECT_ROOT ? '' : newLogsBase,
    archivesDir: newArchivesDir === DEFAULT_ARCHIVES_DIR ? '' : newArchivesDir,
    retentionDays: newRetentionDays,
    retentionAction: newRetentionAction
  };

  writeSettingsFile(settingsToSave);
  return getSettings();
}
