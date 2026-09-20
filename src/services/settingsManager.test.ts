import fs from 'fs';
import path from 'path';
import * as settingsManager from './settingsManager';

jest.mock('fs');

describe('Settings Manager (src/services/settingsManager.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['PROXY_CONFIG_DIR'];
    delete process.env['PROXY_LOGS_DIR'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Default path resolutions', () => {
    it('should return default directories when no env and no settings.json exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      expect(settingsManager.getConfigDir()).toBe(settingsManager.DEFAULT_CONFIG_DIR);
      expect(settingsManager.getConfigFile()).toBe(
        path.join(settingsManager.DEFAULT_CONFIG_DIR, 'applications.json')
      );
      expect(settingsManager.getLogsDir()).toBe(settingsManager.DEFAULT_LOGS_DIR);
      expect(settingsManager.getHeadersDir()).toBe(settingsManager.DEFAULT_HEADERS_DIR);
      expect(settingsManager.getArchivesDir()).toBe(settingsManager.DEFAULT_ARCHIVES_DIR);
    });

    it('should correctly flag defaults in getSettings()', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const settings = settingsManager.getSettings();
      expect(settings.isDefaultConfig).toBe(true);
      expect(settings.isDefaultLogs).toBe(true);
      expect(settings.configDir).toBe(settingsManager.DEFAULT_CONFIG_DIR);
    });
  });

  describe('Environment variable overrides', () => {
    it('should prioritize PROXY_CONFIG_DIR over settings.json and defaults', () => {
      const customConfig = path.resolve('/custom/config/dir');
      process.env['PROXY_CONFIG_DIR'] = customConfig;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ configDir: '/some/other/dir' })
      );

      expect(settingsManager.getConfigDir()).toBe(customConfig);
    });

    it('should prioritize PROXY_LOGS_DIR over settings.json and defaults', () => {
      const customLogsBase = path.resolve('/custom/logs/base');
      process.env['PROXY_LOGS_DIR'] = customLogsBase;

      expect(settingsManager.getLogsBaseDir()).toBe(customLogsBase);
      expect(settingsManager.getLogsDir()).toBe(path.join(customLogsBase, 'logs'));
      expect(settingsManager.getHeadersDir()).toBe(path.join(customLogsBase, 'headers'));
      expect(settingsManager.getArchivesDir()).toBe(path.join(customLogsBase, 'archives'));
    });
  });

  describe('settings.json file configuration', () => {
    it('should use paths from settings.json when present', () => {
      const customConfig = path.resolve('/file/config');
      const customLogs = path.resolve('/file/logs');

      (fs.existsSync as jest.Mock).mockImplementation((filePath: string) => {
        return filePath.endsWith('settings.json');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ configDir: customConfig, logsDir: customLogs })
      );

      expect(settingsManager.getConfigDir()).toBe(customConfig);
      expect(settingsManager.getLogsBaseDir()).toBe(customLogs);
      expect(settingsManager.getLogsDir()).toBe(path.join(customLogs, 'logs'));
      expect(settingsManager.getHeadersDir()).toBe(path.join(customLogs, 'headers'));
      expect(settingsManager.getArchivesDir()).toBe(path.join(customLogs, 'archives'));
    });

    it('should handle corrupt settings.json gracefully and fall back to defaults', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid JSON string');

      expect(settingsManager.getConfigDir()).toBe(settingsManager.DEFAULT_CONFIG_DIR);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('updateSettings()', () => {
    it('should create directories and write new settings.json', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const fileMap = new Map<string, string>();
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => fileMap.has(p));
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => fileMap.get(p) || '');
      (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
        fileMap.set(p, data);
      });

      const targetConfig = path.resolve('/new/config');
      const targetLogs = path.resolve('/new/logs');

      const updated = settingsManager.updateSettings({
        configDir: targetConfig,
        logsDir: targetLogs,
        migrateExistingConfig: false
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(targetConfig, { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(targetLogs, 'logs'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(targetLogs, 'headers'), { recursive: true });
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(targetLogs, 'archives'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(updated.configDir).toBe(targetConfig);
      expect(updated.logsBaseDir).toBe(targetLogs);
      expect(updated.isDefaultConfig).toBe(false);
      expect(updated.isDefaultLogs).toBe(false);
      logSpy.mockRestore();
    });

    it('should migrate existing applications.json if migrateExistingConfig is true', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const oldConfigDir = settingsManager.DEFAULT_CONFIG_DIR;
      const newConfigDir = path.resolve('/migrated/config');
      const fileMap = new Map<string, string>();
      fileMap.set(path.join(oldConfigDir, 'applications.json'), JSON.stringify([{ id: 'app1', name: 'App 1' }]));

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => fileMap.has(p));
      (fs.readFileSync as jest.Mock).mockImplementation((p: string) => fileMap.get(p) || '');
      (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
        fileMap.set(p, data);
      });

      settingsManager.updateSettings({
        configDir: newConfigDir,
        migrateExistingConfig: true
      });

      const newConfigFile = path.join(newConfigDir, 'applications.json');
      expect(fileMap.get(newConfigFile)).toBe(JSON.stringify([{ id: 'app1', name: 'App 1' }]));
      logSpy.mockRestore();
    });

    it('should throw an error if mkdirSync fails for config directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        settingsManager.updateSettings({ configDir: '/restricted/path' });
      }).toThrow(/Cannot create configuration directory/);
    });
  });
});
