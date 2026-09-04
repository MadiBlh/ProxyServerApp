require('../utils/bootstrap');

const fs = require('fs');
const path = require('path');

/* ==========================================================================
   SETTINGS MANAGER
   Manages storage locations for configurations (applications.json)
   and captured traffic logs/headers.
   Supports project root defaults, user-customized paths via settings.json,
   and environment variables (PROXY_CONFIG_DIR, PROXY_LOGS_DIR).
   ========================================================================== */

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const SETTINGS_FILE = path.join(PROJECT_ROOT, 'settings.json');

const DEFAULT_CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const DEFAULT_LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const DEFAULT_HEADERS_DIR = path.join(PROJECT_ROOT, 'headers');
const DEFAULT_ARCHIVES_DIR = path.join(PROJECT_ROOT, 'archives');

/**
 * Reads local settings from settings.json if present.
 */
function readSettingsFile() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return JSON.parse(data) || {};
    } catch (err) {
      console.warn('[SettingsManager] Error reading settings.json:', err.message);
    }
  }
  return {};
}

/**
 * Writes settings to settings.json.
 */
function writeSettingsFile(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[SettingsManager] Error writing settings.json:', err.message);
    throw err;
  }
}

/**
 * Returns the effective config directory path.
 */
function getConfigDir() {
  const envPath = process.env.PROXY_CONFIG_DIR;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }

  const saved = readSettingsFile();
  if (saved.configDir && saved.configDir.trim()) {
    return path.resolve(saved.configDir.trim());
  }

  return DEFAULT_CONFIG_DIR;
}

/**
 * Returns the path to applications.json.
 */
function getConfigFile() {
  return path.join(getConfigDir(), 'applications.json');
}

/**
 * Returns the effective logs directory path (where request/response bodies are saved).
 */
function getLogsDir() {
  const envPath = process.env.PROXY_LOGS_DIR;
  if (envPath && envPath.trim()) {
    const base = path.resolve(envPath.trim());
    return path.join(base, 'logs');
  }

  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    const base = path.resolve(saved.logsDir.trim());
    return path.join(base, 'logs');
  }

  return DEFAULT_LOGS_DIR;
}

/**
 * Returns the effective headers directory path (where header JSON files are saved).
 */
function getHeadersDir() {
  const envPath = process.env.PROXY_LOGS_DIR;
  if (envPath && envPath.trim()) {
    const base = path.resolve(envPath.trim());
    return path.join(base, 'headers');
  }

  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    const base = path.resolve(saved.logsDir.trim());
    return path.join(base, 'headers');
  }

  return DEFAULT_HEADERS_DIR;
}

/**
 * Returns the effective archives directory path (where archived logs are stored).
 */
function getArchivesDir() {
  const envPath = process.env.PROXY_LOGS_DIR;
  if (envPath && envPath.trim()) {
    const base = path.resolve(envPath.trim());
    return path.join(base, 'archives');
  }

  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    const base = path.resolve(saved.logsDir.trim());
    return path.join(base, 'archives');
  }

  return DEFAULT_ARCHIVES_DIR;
}

/**
 * Returns the base logs storage directory (parent of logs/ and headers/).
 */
function getLogsBaseDir() {
  const envPath = process.env.PROXY_LOGS_DIR;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath.trim());
  }

  const saved = readSettingsFile();
  if (saved.logsDir && saved.logsDir.trim()) {
    return path.resolve(saved.logsDir.trim());
  }

  return PROJECT_ROOT;
}

/**
 * Returns a summary of current settings for the dashboard API.
 */
function getSettings() {
  const configDir = getConfigDir();
  const logsBaseDir = getLogsBaseDir();
  const logsDir = getLogsDir();
  const headersDir = getHeadersDir();
  const archivesDir = getArchivesDir();

  const isDefaultConfig = path.resolve(configDir) === path.resolve(DEFAULT_CONFIG_DIR);
  const isDefaultLogs = path.resolve(logsBaseDir) === path.resolve(PROJECT_ROOT);

  return {
    configDir,
    logsBaseDir,
    logsDir,
    headersDir,
    archivesDir,
    isDefaultConfig,
    isDefaultLogs,
    defaults: {
      configDir: DEFAULT_CONFIG_DIR,
      logsBaseDir: PROJECT_ROOT,
      logsDir: DEFAULT_LOGS_DIR,
      headersDir: DEFAULT_HEADERS_DIR,
      archivesDir: DEFAULT_ARCHIVES_DIR
    }
  };
}

/**
 * Updates settings and ensures directories exist.
 * Optionally copies existing applications.json if migrateExistingConfig is true.
 */
function updateSettings({ configDir, logsDir, migrateExistingConfig = false }) {
  const currentConfigFile = getConfigFile();
  const previousConfigDir = getConfigDir();

  const newConfigDir = configDir && configDir.trim() ? path.resolve(configDir.trim()) : DEFAULT_CONFIG_DIR;
  const newLogsBase = logsDir && logsDir.trim() ? path.resolve(logsDir.trim()) : PROJECT_ROOT;

  // Validate and ensure directories can be created
  try {
    if (!fs.existsSync(newConfigDir)) {
      fs.mkdirSync(newConfigDir, { recursive: true });
    }
  } catch (err) {
    throw new Error(`Cannot create configuration directory "${newConfigDir}": ${err.message}`);
  }

  try {
    const targetLogs = newLogsBase === PROJECT_ROOT ? DEFAULT_LOGS_DIR : path.join(newLogsBase, 'logs');
    const targetHeaders = newLogsBase === PROJECT_ROOT ? DEFAULT_HEADERS_DIR : path.join(newLogsBase, 'headers');
    const targetArchives = newLogsBase === PROJECT_ROOT ? DEFAULT_ARCHIVES_DIR : path.join(newLogsBase, 'archives');
    if (!fs.existsSync(targetLogs)) fs.mkdirSync(targetLogs, { recursive: true });
    if (!fs.existsSync(targetHeaders)) fs.mkdirSync(targetHeaders, { recursive: true });
    if (!fs.existsSync(targetArchives)) fs.mkdirSync(targetArchives, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create logs directory "${newLogsBase}": ${err.message}`);
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
        console.warn('[SettingsManager] Failed to migrate applications.json:', err.message);
      }
    }
  }

  // Save to settings.json
  const settingsToSave = {
    configDir: newConfigDir === DEFAULT_CONFIG_DIR ? '' : newConfigDir,
    logsDir: newLogsBase === PROJECT_ROOT ? '' : newLogsBase
  };

  writeSettingsFile(settingsToSave);

  return getSettings();
}

module.exports = {
  getConfigDir,
  getConfigFile,
  getLogsDir,
  getHeadersDir,
  getArchivesDir,
  getLogsBaseDir,
  getSettings,
  updateSettings,
  DEFAULT_CONFIG_DIR,
  DEFAULT_LOGS_DIR,
  DEFAULT_HEADERS_DIR,
  DEFAULT_ARCHIVES_DIR
};
