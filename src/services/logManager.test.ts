import fs from 'fs';
import path from 'path';
import os from 'os';
import * as logManager from './logManager';
import * as settingsManager from './settingsManager';

jest.mock('fs');
jest.mock('./settingsManager');

describe('Log Manager (src/services/logManager.ts)', () => {
  const fakeLogsDir = path.resolve('/mock/logs');
  const fakeHeadersDir = path.resolve('/mock/headers');
  const fakeArchivesDir = path.resolve('/mock/archives');
  const fakeDownloadsDir = path.join(os.homedir(), 'Downloads');

  let fileMap = new Map<string, string>();

  beforeEach(() => {
    jest.clearAllMocks();
    fileMap = new Map<string, string>();

    (settingsManager.getLogsDir as jest.Mock).mockReturnValue(fakeLogsDir);
    (settingsManager.getHeadersDir as jest.Mock).mockReturnValue(fakeHeadersDir);
    (settingsManager.getArchivesDir as jest.Mock).mockReturnValue(fakeArchivesDir);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p === fakeLogsDir || p === fakeHeadersDir || p === fakeArchivesDir || p === fakeDownloadsDir) {
        return true;
      }
      return fileMap.has(p);
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (fileMap.has(p)) return fileMap.get(p)!;
      throw new Error(`ENOENT: no such file, open '${p}'`);
    });

    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
      fileMap.set(p, data);
    });

    (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
      const files: string[] = [];
      for (const filePath of fileMap.keys()) {
        if (path.dirname(filePath) === dir) {
          files.push(path.basename(filePath));
        }
      }
      return files;
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
      isFile: () => fileMap.has(p)
    }));

    (fs.unlinkSync as jest.Mock).mockImplementation((p: string) => {
      fileMap.delete(p);
    });

    (fs.renameSync as jest.Mock).mockImplementation((src: string, dest: string) => {
      const content = fileMap.get(src);
      if (content !== undefined) {
        fileMap.delete(src);
        fileMap.set(dest, content);
      }
    });

    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
  });

  describe('saveLogEntry', () => {
    it('should save json request and response and create meta files', () => {
      const entry = logManager.saveLogEntry({
        id: 'test-uuid-1',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/users',
        method: 'POST',
        endpoint: '/users',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: JSON.stringify({ name: 'Alice' }),
        statusCode: 201,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ id: 10, name: 'Alice' }),
        durationMs: 45
      });

      expect(entry.id).toBe('test-uuid-1');
      expect(entry.reqMeta.fileExtension).toBe('json');
      expect(entry.resMeta.statusCode).toBe(201);
      expect(entry.resMeta.statusText).toBe('OK');

      const reqMetaFile = path.join(fakeHeadersDir, 'test-uuid-1_request.json');
      const resBodyFile = path.join(fakeLogsDir, 'test-uuid-1_response.json');
      expect(fileMap.has(reqMetaFile)).toBe(true);
      expect(fileMap.has(resBodyFile)).toBe(true);
    });

    it('should handle XML content and mark statusText as FAILED for 500 error', () => {
      const entry = logManager.saveLogEntry({
        id: 'test-uuid-2',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/xml',
        method: 'POST',
        endpoint: '/xml',
        requestHeaders: { 'content-type': 'text/xml' },
        requestBody: '<request></request>',
        statusCode: 500,
        responseHeaders: { 'content-type': 'text/xml' },
        responseBody: '<fault></fault>',
        durationMs: 120,
        error: 'Internal Server Error'
      });

      expect(entry.reqMeta.fileExtension).toBe('xml');
      expect(entry.resMeta.statusText).toBe('FAILED');
      expect(entry.resMeta.error).toBe('Internal Server Error');
    });
  });

  describe('getAllLogs & getLogDetail', () => {
    beforeEach(() => {
      logManager.saveLogEntry({
        id: 'uuid-a',
        appId: 'app-1',
        appName: 'App One',
        targetUrl: 'http://api.one.com/items',
        method: 'GET',
        endpoint: '/items',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '',
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify([{ id: 1, name: 'Item One' }]),
        durationMs: 20
      });

      logManager.saveLogEntry({
        id: 'uuid-b',
        appId: 'app-2',
        appName: 'App Two',
        targetUrl: 'http://api.two.com/orders',
        method: 'POST',
        endpoint: '/orders',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: JSON.stringify({ item: 'Widget' }),
        statusCode: 201,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ orderId: 'ord-99' }),
        durationMs: 50
      });
    });

    it('should return all log entries', () => {
      const logs = logManager.getAllLogs();
      expect(logs.length).toBe(2);
    });

    it('should filter logs by appId', () => {
      const logs = logManager.getAllLogs('app-1');
      expect(logs.length).toBe(1);
      expect(logs[0]?.appId).toBe('app-1');
    });

    it('should filter logs by endpoint search query', () => {
      const logs = logManager.getAllLogs(null, null, { endpoint: 'orders' });
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('uuid-b');
    });

    it('should filter logs by body search query', () => {
      const logs = logManager.getAllLogs(null, 'Widget');
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('uuid-b');
    });

    it('should get full log detail by id', () => {
      const detail = logManager.getLogDetail('uuid-a');
      expect(detail).not.toBeNull();
      expect(detail?.id).toBe('uuid-a');
      expect(detail?.requestBody).toBe('');
      expect(detail?.responseBody).toContain('Item One');
    });

    it('should return null for non-existent log detail', () => {
      expect(logManager.getLogDetail('non-existent')).toBeNull();
    });
  });

  describe('clearLogsForApp & deleteLogsByIds & clearAllLogs', () => {
    beforeEach(() => {
      logManager.saveLogEntry({
        id: 'log-1',
        appId: 'app-alpha',
        appName: 'Alpha',
        targetUrl: 'http://alpha.com',
        method: 'GET',
        requestHeaders: {},
        requestBody: '',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'ok',
        durationMs: 10
      });

      logManager.saveLogEntry({
        id: 'log-2',
        appId: 'app-beta',
        appName: 'Beta',
        targetUrl: 'http://beta.com',
        method: 'GET',
        requestHeaders: {},
        requestBody: '',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'ok',
        durationMs: 10
      });
    });

    it('should clear logs only for specified application', () => {
      const deleted = logManager.clearLogsForApp('app-alpha');
      expect(deleted).toBeGreaterThan(0);

      const logs = logManager.getAllLogs();
      expect(logs.length).toBe(1);
      expect(logs[0]?.appId).toBe('app-beta');
    });

    it('should delete specific logs by IDs', () => {
      const deleted = logManager.deleteLogsByIds(['log-2']);
      expect(deleted).toBeGreaterThan(0);

      const logs = logManager.getAllLogs();
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('log-1');
    });

    it('should clear all logs completely', () => {
      logManager.clearAllLogs();
      const logs = logManager.getAllLogs();
      expect(logs.length).toBe(0);
    });
  });

  describe('archiveLogsForApp', () => {
    it('should archive logs for an application', () => {
      logManager.saveLogEntry({
        id: 'arch-1',
        appId: 'app-archive-target',
        appName: 'Archive App',
        targetUrl: 'http://archive.com',
        method: 'GET',
        requestHeaders: {},
        requestBody: 'req',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'res',
        durationMs: 10
      });

      const res = logManager.archiveLogsForApp('app-archive-target', 'Archive App');
      expect(res.archived).toBeGreaterThan(0);
      expect(res.archivePath).toContain('Archive App');

      // Remaining logs in active dir should be 0
      const remaining = logManager.getAllLogs('app-archive-target');
      expect(remaining.length).toBe(0);
    });

    it('should return 0 when appId is empty', () => {
      const res = logManager.archiveLogsForApp('');
      expect(res.archived).toBe(0);
    });
  });

  describe('exportLog', () => {
    it('should export request and response files to downloads folder', () => {
      logManager.saveLogEntry({
        id: 'export-target',
        appId: 'app-export',
        appName: 'Export App',
        targetUrl: 'http://export.com',
        method: 'GET',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '{"test":true}',
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"success":true}',
        durationMs: 15
      });

      const res = logManager.exportLog('export-target', 'my_custom_export');
      expect(res).not.toBeNull();
      expect(res?.requestFile).toBe('my_custom_export_request.json');
      expect(res?.responseFile).toBe('my_custom_export_response.json');

      const expectedReqPath = path.join(fakeDownloadsDir, 'my_custom_export_request.json');
      expect(fileMap.has(expectedReqPath)).toBe(true);
    });

    it('should return null if log does not exist', () => {
      expect(logManager.exportLog('unknown-id', 'test')).toBeNull();
    });
  });
});
