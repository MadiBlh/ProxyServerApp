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
      const norm = path.normalize(p);
      if (norm === fakeLogsDir || norm === fakeHeadersDir || norm === fakeArchivesDir || norm === fakeDownloadsDir) {
        return true;
      }
      if (fileMap.has(norm)) return true;
      for (const k of fileMap.keys()) {
        if (k.startsWith(norm + path.sep)) return true;
      }
      return false;
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      const norm = path.normalize(p);
      if (fileMap.has(norm)) return fileMap.get(norm)!;
      throw new Error(`ENOENT: no such file, open '${norm}'`);
    });

    (fs.writeFileSync as jest.Mock).mockImplementation((p: string, data: string) => {
      fileMap.set(path.normalize(p), data);
    });

    (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
      const entries = new Set<string>();
      const normDir = path.normalize(dir);
      for (const filePath of fileMap.keys()) {
        if (filePath.startsWith(normDir + path.sep)) {
          const rel = path.relative(normDir, filePath);
          const parts = rel.split(path.sep);
          if (parts.length > 0 && parts[0]) {
            entries.add(parts[0]);
          }
        }
      }
      return Array.from(entries);
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => {
      const norm = path.normalize(p);
      if (fileMap.has(norm)) {
        return {
          isFile: () => true,
          isDirectory: () => false
        };
      }
      let isDir = false;
      for (const filePath of fileMap.keys()) {
        if (filePath.startsWith(norm + path.sep)) {
          isDir = true;
          break;
        }
      }
      return {
        isFile: () => false,
        isDirectory: () => isDir || norm === fakeLogsDir || norm === fakeHeadersDir || norm === fakeArchivesDir || norm === fakeDownloadsDir
      };
    });

    (fs.unlinkSync as jest.Mock).mockImplementation((p: string) => {
      fileMap.delete(path.normalize(p));
    });

    (fs.rmdirSync as jest.Mock).mockImplementation(() => undefined);

    if (fs.rmSync) {
      (fs.rmSync as jest.Mock).mockImplementation((dir: string) => {
        const normDir = path.normalize(dir);
        for (const k of Array.from(fileMap.keys())) {
          if (k === normDir || k.startsWith(normDir + path.sep)) {
            fileMap.delete(k);
          }
        }
      });
    }

    (fs.renameSync as jest.Mock).mockImplementation((src: string, dest: string) => {
      const normSrc = path.normalize(src);
      const normDest = path.normalize(dest);
      const content = fileMap.get(normSrc);
      if (content !== undefined) {
        fileMap.delete(normSrc);
        fileMap.set(normDest, content);
      }
    });

    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

    logManager.clearDirectoryCache();
    logManager.clearRecentLogsCache();

    if (!fs.promises) {
      (fs as unknown as { promises: { writeFile: jest.Mock } }).promises = {
        writeFile: jest.fn().mockImplementation(async (p: string, data: string) => {
          fileMap.set(path.normalize(p), data);
        })
      };
    } else {
      (fs.promises.writeFile as jest.Mock) = jest.fn().mockImplementation(async (p: string, data: string) => {
        fileMap.set(path.normalize(p), data);
      });
    }
  });

  describe('getDateFolder & getAvailableDateFolders', () => {
    it('should format ISO timestamp to YYYY-MM-DD', () => {
      expect(logManager.getDateFolder('2026-09-19T07:50:40.000Z')).toBe('2026-09-19');
      expect(logManager.getDateFolder('2026-05-01')).toBe('2026-05-01');
    });

    it('should return available date subfolders sorted descending', () => {
      fileMap.set(path.join(fakeHeadersDir, '2026-09-18', 'test1_request.json'), JSON.stringify({ appId: 'app-1' }));
      fileMap.set(path.join(fakeHeadersDir, '2026-09-19', 'test2_request.json'), JSON.stringify({ appId: 'app-2' }));
      fileMap.set(path.join(fakeHeadersDir, '2026-09-15', 'test3_request.json'), JSON.stringify({ appId: 'app-1' }));

      const dates = logManager.getAvailableDateFolders();
      expect(dates).toEqual(['2026-09-19', '2026-09-18', '2026-09-15']);

      const app1Dates = logManager.getAvailableDateFolders('app-1');
      expect(app1Dates).toEqual(['2026-09-18', '2026-09-15']);

      const app2Dates = logManager.getAvailableDateFolders('app-2');
      expect(app2Dates).toEqual(['2026-09-19']);
    });
  });

  describe('saveLogEntry', () => {
    it('should save json request and response into date-based subfolder and create meta files', () => {
      const entry = logManager.saveLogEntry({
        id: 'test-uuid-1',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/users',
        method: 'POST',
        endpoint: '/users',
        date: '2026-09-19',
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

      const reqMetaFile = path.join(fakeHeadersDir, '2026-09-19', 'test-uuid-1_request.json');
      const resBodyFile = path.join(fakeLogsDir, '2026-09-19', 'test-uuid-1_response.json');
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
        date: '2026-09-19',
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

    it('should cache directory existence to avoid redundant mkdirSync calls on repeated saves', () => {
      (fs.mkdirSync as jest.Mock).mockClear();

      // First save triggers directory creation
      logManager.saveLogEntry({
        id: 'dir-cache-1',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/1',
        date: '2026-09-19',
        requestHeaders: {}
      });

      const initialMkdirCalls = (fs.mkdirSync as jest.Mock).mock.calls.length;
      expect(initialMkdirCalls).toBeGreaterThan(0);

      // Second save on the same date uses directory cache (0 additional mkdirSync calls)
      (fs.mkdirSync as jest.Mock).mockClear();
      logManager.saveLogEntry({
        id: 'dir-cache-2',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/2',
        date: '2026-09-19',
        requestHeaders: {}
      });

      expect(fs.mkdirSync).not.toHaveBeenCalled();

      // After clearing directory cache, save on a new date will check and create again
      logManager.clearDirectoryCache();
      logManager.saveLogEntry({
        id: 'dir-cache-3',
        appId: 'app-1',
        appName: 'Application 1',
        targetUrl: 'http://api.backend.com/3',
        date: '2026-09-20',
        requestHeaders: {}
      });

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should store and instantly retrieve recent log details from in-memory cache', () => {
      const saved = logManager.saveLogEntry({
        id: 'instant-cache-uuid',
        appId: 'app-1',
        appName: 'App 1',
        targetUrl: 'http://api.backend.com/cached',
        date: '2026-09-19',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '{"cached":true}',
        responseBody: '{"ok":true}'
      });

      // getLogDetail retrieves from memory cache
      const detail = logManager.getLogDetail('instant-cache-uuid');
      expect(detail).not.toBeNull();
      expect(detail?.requestBody).toBe('{"cached":true}');
      expect(detail?.responseBody).toBe('{"ok":true}');
    });
  });

  describe('getAllLogs & getLogDetail', () => {
    beforeEach(() => {
      // Log on 2026-09-18
      logManager.saveLogEntry({
        id: 'uuid-yesterday',
        appId: 'app-1',
        appName: 'App One',
        targetUrl: 'http://api.one.com/old',
        method: 'GET',
        endpoint: '/old',
        date: '2026-09-18',
        timestamp: '2026-09-18T10:00:00.000Z',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '',
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: 'old data',
        durationMs: 10
      });

      // Logs on 2026-09-19 (latest date)
      logManager.saveLogEntry({
        id: 'uuid-a',
        appId: 'app-1',
        appName: 'App One',
        targetUrl: 'http://api.one.com/items',
        method: 'GET',
        endpoint: '/items',
        date: '2026-09-19',
        timestamp: '2026-09-19T10:00:00.000Z',
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
        date: '2026-09-19',
        timestamp: '2026-09-19T11:00:00.000Z',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: JSON.stringify({ item: 'Widget' }),
        statusCode: 201,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: JSON.stringify({ orderId: 'ord-99' }),
        durationMs: 50
      });
    });

    it('should return only logs from the most recent date by default', () => {
      const logs = logManager.getAllLogs();
      // Should return 2 entries from 2026-09-19, ignoring 2026-09-18
      expect(logs.length).toBe(2);
      expect(logs.map(l => l.id)).toEqual(['uuid-b', 'uuid-a']);
    });

    it('should return logs from a specific requested date', () => {
      const logs = logManager.getAllLogs(null, null, { date: '2026-09-18' });
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('uuid-yesterday');
    });

    it('should return logs for period presets', () => {
      const logsAll = logManager.getAllLogs(null, null, { period: 'all' });
      expect(logsAll.length).toBe(3);

      const logsRange = logManager.getAllLogs(null, null, { startDate: '2026-09-18', endDate: '2026-09-18' });
      expect(logsRange.length).toBe(1);
      expect(logsRange[0]?.id).toBe('uuid-yesterday');
    });

    it('should return all logs across all dates when date is "all"', () => {
      const logs = logManager.getAllLogs(null, null, { date: 'all' });
      expect(logs.length).toBe(3);
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

    it('should match multiple tokens in endpoint search (method + path + status)', () => {
      const logsMethodAndPath = logManager.getAllLogs(null, null, { endpoint: 'POST orders' });
      expect(logsMethodAndPath.length).toBe(1);
      expect(logsMethodAndPath[0]?.id).toBe('uuid-b');

      const logsStatusAndPath = logManager.getAllLogs(null, null, { endpoint: '201 orders' });
      expect(logsStatusAndPath.length).toBe(1);
      expect(logsStatusAndPath[0]?.id).toBe('uuid-b');

      const logsMismatch = logManager.getAllLogs(null, null, { endpoint: 'GET orders' });
      expect(logsMismatch.length).toBe(0);
    });

    it('should filter logs by explicit method option', () => {
      const postLogs = logManager.getAllLogs(null, null, { method: 'POST' });
      expect(postLogs.length).toBe(1);
      expect(postLogs[0]?.id).toBe('uuid-b');

      const getLogs = logManager.getAllLogs(null, null, { method: 'GET' });
      expect(getLogs.length).toBe(1);
      expect(getLogs[0]?.id).toBe('uuid-a');
    });

    it('should filter logs by explicit status option', () => {
      const createdLogs = logManager.getAllLogs(null, null, { status: 201 });
      expect(createdLogs.length).toBe(1);
      expect(createdLogs[0]?.id).toBe('uuid-b');

      const okLogs = logManager.getAllLogs(null, null, { status: 200 });
      expect(okLogs.length).toBe(1);
      expect(okLogs[0]?.id).toBe('uuid-a');
    });

    it('should filter logs by body search query', () => {
      const logs = logManager.getAllLogs(null, 'Widget');
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('uuid-b');
    });

    it('should filter logs by header content in body search query', () => {
      const logs = logManager.getAllLogs(null, 'application/json');
      // Both uuid-a and uuid-b have content-type: application/json
      expect(logs.length).toBe(2);
    });

    it('should support limit and offset options for pagination', () => {
      const allLogs = logManager.getAllLogs(null, null, { period: 'all' });
      expect(allLogs.length).toBeGreaterThanOrEqual(2);

      const limited = logManager.getAllLogs(null, null, { period: 'all', limit: 1 });
      expect(limited.length).toBe(1);
      expect(limited[0]?.id).toBe(allLogs[0]?.id);

      const offsetLogs = logManager.getAllLogs(null, null, { period: 'all', offset: 1, limit: 1 });
      expect(offsetLogs.length).toBe(1);
      expect(offsetLogs[0]?.id).toBe(allLogs[1]?.id);
    });

    it('should get full log detail by id across date subfolders', () => {
      const detailA = logManager.getLogDetail('uuid-a');
      expect(detailA).not.toBeNull();
      expect(detailA?.id).toBe('uuid-a');
      expect(detailA?.requestBody).toBe('');
      expect(detailA?.responseBody).toContain('Item One');

      const detailYesterday = logManager.getLogDetail('uuid-yesterday');
      expect(detailYesterday).not.toBeNull();
      expect(detailYesterday?.id).toBe('uuid-yesterday');
      expect(detailYesterday?.responseBody).toBe('old data');
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
        date: '2026-09-19',
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
        date: '2026-09-19',
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
    it('should archive logs preserving date partition and generate manifest', () => {
      logManager.saveLogEntry({
        id: 'arch-1',
        appId: 'app-archive-target',
        appName: 'Archive App',
        targetUrl: 'http://archive.com',
        method: 'GET',
        date: '2026-09-19',
        requestHeaders: {},
        requestBody: 'req-1',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'res-1',
        durationMs: 10
      });

      logManager.saveLogEntry({
        id: 'arch-2',
        appId: 'app-archive-target',
        appName: 'Archive App',
        targetUrl: 'http://archive.com/two',
        method: 'POST',
        date: '2026-09-19',
        requestHeaders: {},
        requestBody: 'req-2',
        statusCode: 201,
        responseHeaders: {},
        responseBody: 'res-2',
        durationMs: 20
      });

      const res = logManager.archiveLogsForApp('app-archive-target', 'Archive App');
      // Exactly 2 transactions archived
      expect(res.archived).toBe(2);
      expect(res.archivePath).toContain('Archive App');
      expect(res.manifest).toBeDefined();
      expect(res.manifest?.totalTransactionsArchived).toBe(2);
      expect(res.manifest?.dates).toContain('2026-09-19');

      // Remaining logs in active dir should be 0
      const remaining = logManager.getAllLogs('app-archive-target');
      expect(remaining.length).toBe(0);
    });

    it('should support selective archiving by specific IDs array', () => {
      logManager.saveLogEntry({
        id: 'arch-sel-1',
        appId: 'app-sel-target',
        appName: 'Selective App',
        targetUrl: 'http://sel.com/1',
        method: 'GET',
        date: '2026-09-19',
        requestHeaders: {},
        requestBody: 'req-sel-1',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'res-sel-1',
        durationMs: 10
      });

      logManager.saveLogEntry({
        id: 'arch-sel-2',
        appId: 'app-sel-target',
        appName: 'Selective App',
        targetUrl: 'http://sel.com/2',
        method: 'GET',
        date: '2026-09-19',
        requestHeaders: {},
        requestBody: 'req-sel-2',
        statusCode: 200,
        responseHeaders: {},
        responseBody: 'res-sel-2',
        durationMs: 15
      });

      // Archive only arch-sel-1
      const res = logManager.archiveLogsForApp('app-sel-target', 'Selective App', {
        ids: ['arch-sel-1']
      });

      expect(res.archived).toBe(1);
      expect(res.manifest?.totalTransactionsArchived).toBe(1);

      // arch-sel-2 should still be in active logs
      const remaining = logManager.getAllLogs('app-sel-target');
      expect(remaining.length).toBe(1);
      expect(remaining[0]?.id).toBe('arch-sel-2');
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
        date: '2026-09-19',
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

  describe('Archive Explorer & Restoration', () => {
    beforeEach(() => {
      // Archive logs for a sample app
      logManager.saveLogEntry({
        id: 'arch-exp-1',
        appId: 'app-explorer',
        appName: 'Explorer App',
        targetUrl: 'http://explorer.com/users',
        method: 'GET',
        endpoint: '/users',
        date: '2026-09-19',
        requestHeaders: { authorization: 'Bearer 123' },
        requestBody: '',
        statusCode: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"users":["alice"]}',
        durationMs: 25
      });

      logManager.archiveLogsForApp('app-explorer', 'Explorer App');
    });

    it('getArchivedApps should list all archived applications with manifest data', () => {
      const apps = logManager.getArchivedApps();
      expect(apps.length).toBeGreaterThanOrEqual(1);
      const expApp = apps.find(a => a.appName === 'Explorer App');
      expect(expApp).toBeDefined();
      expect(expApp?.totalTransactions).toBe(1);
      expect(expApp?.dates).toContain('2026-09-19');
    });

    it('getArchivedLogs should return archived logs list with search filter', () => {
      const logs = logManager.getArchivedLogs('Explorer App');
      expect(logs.length).toBe(1);
      expect(logs[0]?.id).toBe('arch-exp-1');

      const filtered = logManager.getArchivedLogs('Explorer App', { endpoint: 'users' });
      expect(filtered.length).toBe(1);

      const unmatched = logManager.getArchivedLogs('Explorer App', { endpoint: 'orders' });
      expect(unmatched.length).toBe(0);
    });

    it('getArchivedLogDetail should return full archived request/response payload', () => {
      const detail = logManager.getArchivedLogDetail('Explorer App', 'arch-exp-1');
      expect(detail).not.toBeNull();
      expect(detail?.id).toBe('arch-exp-1');
      expect(detail?.responseBody).toContain('alice');
      expect(detail?.reqMeta.headers?.authorization).toBe('Bearer 123');
    });

    it('restoreArchivedLogs should move logs back into active logs directory', () => {
      const res = logManager.restoreArchivedLogs('Explorer App', { ids: ['arch-exp-1'] });
      expect(res.restored).toBe(1);
      expect(res.appName).toBe('Explorer App');

      // Should now be back in active logs
      const activeLogs = logManager.getAllLogs('app-explorer');
      expect(activeLogs.length).toBe(1);
      expect(activeLogs[0]?.id).toBe('arch-exp-1');
    });

    it('restoreArchivedLogs should restore specific date folder only', () => {
      const res = logManager.restoreArchivedLogs('Explorer App', { date: '2026-09-19' });
      expect(res.restored).toBe(1);
      expect(res.appName).toBe('Explorer App');

      const activeLogs = logManager.getAllLogs('app-explorer');
      expect(activeLogs.length).toBe(1);
    });

    it('deleteArchivedApp with specific date should delete only that date partition', () => {
      const deleted = logManager.deleteArchivedApp('Explorer App', '2026-09-19');
      expect(deleted).toBe(true);

      const apps = logManager.getArchivedApps();
      expect(apps.find(a => a.appName === 'Explorer App')).toBeUndefined();
    });

    it('deleteArchivedApp should remove entire archive folder from disk when no date specified', () => {
      const deleted = logManager.deleteArchivedApp('Explorer App');
      expect(deleted).toBe(true);

      const apps = logManager.getArchivedApps();
      expect(apps.find(a => a.appName === 'Explorer App')).toBeUndefined();
    });
  });
});

