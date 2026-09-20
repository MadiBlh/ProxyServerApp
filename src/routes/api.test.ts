import http from 'http';
import { EventEmitter } from 'events';
import express from 'express';
import request from 'supertest';
import apiRouter from './api';
import * as configManager from '../services/configManager';
import * as logManager from '../services/logManager';
import * as settingsManager from '../services/settingsManager';
import * as redirectProxyManager from '../services/redirectProxyManager';
import * as replayService from '../services/replayService';
import * as proxyEngine from '../services/proxyEngine';

jest.mock('../services/configManager');
jest.mock('../services/logManager');
jest.mock('../services/settingsManager');
jest.mock('../services/redirectProxyManager');
jest.mock('../services/replayService');
jest.mock('../services/proxyEngine');

describe('API Routes (src/routes/api.ts)', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use('/dashboard-api', apiRouter);
  });

  describe('Settings Endpoints', () => {
    it('GET /dashboard-api/settings should return current settings', async () => {
      const mockSettings = {
        configDir: '/app/config',
        logsBaseDir: '/app',
        logsDir: '/app/logs',
        headersDir: '/app/headers',
        archivesDir: '/app/archives',
        isDefaultConfig: true,
        isDefaultLogs: true,
        defaults: {
          configDir: '/app/config',
          logsBaseDir: '/app',
          logsDir: '/app/logs',
          headersDir: '/app/headers',
          archivesDir: '/app/archives'
        }
      };
      (settingsManager.getSettings as jest.Mock).mockReturnValue(mockSettings);

      const res = await request(app).get('/dashboard-api/settings');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockSettings);
    });

    it('PUT /dashboard-api/settings should update settings and sync proxies', async () => {
      const updated = { configDir: '/new/config', logsDir: '/new/logs' };
      (settingsManager.updateSettings as jest.Mock).mockReturnValue(updated);
      (configManager.getApplications as jest.Mock).mockReturnValue([]);

      const res = await request(app)
        .put('/dashboard-api/settings')
        .send({ configDir: '/new/config', logsDir: '/new/logs', migrateExistingConfig: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(redirectProxyManager.syncRedirectProxies).toHaveBeenCalled();
    });

    it('PUT /dashboard-api/settings should return 400 if updateSettings throws', async () => {
      (settingsManager.updateSettings as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const res = await request(app).put('/dashboard-api/settings').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Permission denied');
    });
  });

  describe('Applications Endpoints', () => {
    it('GET /dashboard-api/applications should return all apps', async () => {
      const apps = [{ id: 'app-1', name: 'App One' }];
      (configManager.getApplications as jest.Mock).mockReturnValue(apps);

      const res = await request(app).get('/dashboard-api/applications');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(apps);
    });

    it('POST /dashboard-api/applications should create an app and return 201', async () => {
      const newApp = { id: 'app-new', name: 'New App' };
      (configManager.createApplicationAsync as jest.Mock).mockResolvedValue(newApp);
      (configManager.getApplications as jest.Mock).mockReturnValue([newApp]);

      const res = await request(app)
        .post('/dashboard-api/applications')
        .send({ name: 'New App' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newApp);
      expect(redirectProxyManager.syncRedirectProxies).toHaveBeenCalled();
    });

    it('PUT /dashboard-api/applications/:id should update an existing app', async () => {
      const updated = { id: 'app-1', name: 'Updated' };
      (configManager.updateApplicationAsync as jest.Mock).mockResolvedValue(updated);
      (configManager.getApplications as jest.Mock).mockReturnValue([updated]);

      const res = await request(app)
        .put('/dashboard-api/applications/app-1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });

    it('PUT /dashboard-api/applications/:id should return 404 if app not found', async () => {
      (configManager.updateApplicationAsync as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .put('/dashboard-api/applications/unknown')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Application not found');
    });

    it('DELETE /dashboard-api/applications/:id should delete an app', async () => {
      (configManager.deleteApplication as jest.Mock).mockReturnValue(true);

      const res = await request(app).delete('/dashboard-api/applications/app-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('DELETE /dashboard-api/applications/:id should return 404 if not found', async () => {
      (configManager.deleteApplication as jest.Mock).mockReturnValue(false);

      const res = await request(app).delete('/dashboard-api/applications/unknown');
      expect(res.status).toBe(404);
    });

    it('GET /dashboard-api/redirect-proxies should return running redirect proxies', async () => {
      const proxies = [{ id: 'p1', port: 5001, targetUrl: 'http://api.local' }];
      (redirectProxyManager.getRunningRedirects as jest.Mock).mockReturnValue(proxies);

      const res = await request(app).get('/dashboard-api/redirect-proxies');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(proxies);
    });
  });

  describe('Logs Endpoints', () => {
    it('GET /dashboard-api/logs/dates should return available dates and forward appId query param', async () => {
      const dates = ['2026-09-19', '2026-09-18'];
      (logManager.getAvailableDateFolders as jest.Mock).mockReturnValue(dates);

      const res = await request(app).get('/dashboard-api/logs/dates?appId=app-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(dates);
      expect(logManager.getAvailableDateFolders).toHaveBeenCalledWith('app-1');
    });

    it('GET /dashboard-api/logs should return filtered logs with date parameter', async () => {
      const logs = [{ id: 'l1', endpoint: '/users' }];
      (logManager.getAllLogs as jest.Mock).mockReturnValue(logs);

      const res = await request(app).get('/dashboard-api/logs?appId=app-1&endpoint=users&date=2026-09-19');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(logs);
      expect(logManager.getAllLogs).toHaveBeenCalledWith('app-1', null, {
        endpoint: 'users',
        body: '',
        method: undefined,
        status: undefined,
        date: '2026-09-19',
        period: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined
      });
    });

    it('GET /dashboard-api/logs should pass method and status query params', async () => {
      const logs = [{ id: 'l2', endpoint: '/orders', method: 'POST', statusCode: 201 }];
      (logManager.getAllLogs as jest.Mock).mockReturnValue(logs);

      const res = await request(app).get('/dashboard-api/logs?method=POST&status=201');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(logs);
      expect(logManager.getAllLogs).toHaveBeenCalledWith(null, null, {
        endpoint: '',
        body: '',
        method: 'POST',
        status: '201',
        date: undefined,
        period: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined
      });
    });

    it('GET /dashboard-api/logs should pass limit and offset when provided', async () => {
      const logs = [{ id: 'l1', endpoint: '/users' }];
      (logManager.getAllLogs as jest.Mock).mockReturnValue(logs);

      const res = await request(app).get('/dashboard-api/logs?limit=10&offset=20');
      expect(res.status).toBe(200);
      expect(logManager.getAllLogs).toHaveBeenCalledWith(null, null, {
        endpoint: '',
        body: '',
        date: undefined,
        period: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 10,
        offset: 20
      });
    });

    it('GET /dashboard-api/logs/:id should return log detail', async () => {
      const detail = { id: 'l1', requestBody: 'abc' };
      (logManager.getLogDetail as jest.Mock).mockReturnValue(detail);

      const res = await request(app).get('/dashboard-api/logs/l1?date=2026-09-19');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(detail);
      expect(logManager.getLogDetail).toHaveBeenCalledWith('l1', '2026-09-19');
    });

    it('GET /dashboard-api/logs/:id should return 404 if detail not found', async () => {
      (logManager.getLogDetail as jest.Mock).mockReturnValue(null);

      const res = await request(app).get('/dashboard-api/logs/unknown');
      expect(res.status).toBe(404);
    });

    it('DELETE /dashboard-api/logs with ids should delete specific logs', async () => {
      (logManager.deleteLogsByIds as jest.Mock).mockReturnValue(2);

      const res = await request(app)
        .delete('/dashboard-api/logs')
        .send({ ids: ['id-1', 'id-2'] });

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);
    });

    it('DELETE /dashboard-api/logs with appId should clear logs for app', async () => {
      (logManager.clearLogsForApp as jest.Mock).mockReturnValue(5);

      const res = await request(app)
        .delete('/dashboard-api/logs')
        .send({ appId: 'app-target' });

      expect(res.status).toBe(200);
      expect(res.body.appId).toBe('app-target');
      expect(res.body.deleted).toBe(5);
    });

    it('DELETE /dashboard-api/logs without body should clear all logs', async () => {
      (logManager.clearAllLogs as jest.Mock).mockReturnValue(true);

      const res = await request(app).delete('/dashboard-api/logs').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /dashboard-api/logs/archive should archive logs for an app', async () => {
      (logManager.archiveLogsForApp as jest.Mock).mockReturnValue({
        archived: 3,
        archivePath: '/archives/App',
        manifest: { totalTransactionsArchived: 3 }
      });

      const res = await request(app)
        .post('/dashboard-api/logs/archive')
        .send({ appId: 'app-1', appName: 'App', ids: ['id-1', 'id-2'] });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(3);
      expect(logManager.archiveLogsForApp).toHaveBeenCalledWith('app-1', 'App', {
        ids: ['id-1', 'id-2'],
        date: undefined,
        period: undefined,
        startDate: undefined,
        endDate: undefined
      });
    });

    it('POST /dashboard-api/logs/archive should return 400 if appId missing', async () => {
      const res = await request(app).post('/dashboard-api/logs/archive').send({});
      expect(res.status).toBe(400);
    });

    it('DELETE /dashboard-api/logs/:id should delete single log', async () => {
      (logManager.deleteLogsByIds as jest.Mock).mockReturnValue(1);

      const res = await request(app).delete('/dashboard-api/logs/log-1');
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);
    });

    it('DELETE /dashboard-api/logs/:id should return 404 if log not found', async () => {
      (logManager.deleteLogsByIds as jest.Mock).mockReturnValue(0);

      const res = await request(app).delete('/dashboard-api/logs/unknown');
      expect(res.status).toBe(404);
    });

    it('POST /dashboard-api/logs/:id/export should export log files', async () => {
      const exportResult = {
        downloadPath: '/downloads',
        requestFile: 'out_request.json',
        responseFile: 'out_response.json'
      };
      (logManager.exportLog as jest.Mock).mockReturnValue(exportResult);

      const res = await request(app)
        .post('/dashboard-api/logs/log-1/export')
        .send({ fileName: 'out' });

      expect(res.status).toBe(200);
      expect(res.body.files).toEqual(exportResult);
    });

    it('POST /dashboard-api/logs/:id/export should return 400 if fileName missing', async () => {
      const res = await request(app).post('/dashboard-api/logs/log-1/export').send({});
      expect(res.status).toBe(400);
    });

    it('POST /dashboard-api/logs/:id/replay should execute request replay', async () => {
      const replayResult = {
        success: true,
        statusCode: 200,
        statusText: 'OK',
        durationMs: 15,
        headers: {},
        body: 'ok'
      };
      (replayService.replayRequest as jest.Mock).mockResolvedValue(replayResult);

      const res = await request(app)
        .post('/dashboard-api/logs/log-1/replay')
        .send({ customMethod: 'GET' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(replayResult);
    });
  });

  describe('Archive Management Endpoints', () => {
    it('GET /dashboard-api/archives should list archived apps', async () => {
      const archives = [{ appName: 'App1', totalTransactions: 5, dates: ['2026-09-19'] }];
      (logManager.getArchivedApps as jest.Mock).mockReturnValue(archives);

      const res = await request(app).get('/dashboard-api/archives');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(archives);
    });

    it('GET /dashboard-api/archives/:appName/logs should return archived logs', async () => {
      const logs = [{ id: 'arch-1', endpoint: '/users' }];
      (logManager.getArchivedLogs as jest.Mock).mockReturnValue(logs);

      const res = await request(app).get('/dashboard-api/archives/App1/logs?endpoint=users&date=2026-09-19');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(logs);
      expect(logManager.getArchivedLogs).toHaveBeenCalledWith('App1', {
        endpoint: 'users',
        body: '',
        method: undefined,
        status: undefined,
        date: '2026-09-19',
        limit: undefined,
        offset: undefined
      });
    });

    it('GET /dashboard-api/archives/:appName/logs/:id should return archived log detail', async () => {
      const detail = { id: 'arch-1', requestBody: 'hello' };
      (logManager.getArchivedLogDetail as jest.Mock).mockReturnValue(detail);

      const res = await request(app).get('/dashboard-api/archives/App1/logs/arch-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(detail);
    });

    it('GET /dashboard-api/archives/:appName/logs/:id should return 404 if not found', async () => {
      (logManager.getArchivedLogDetail as jest.Mock).mockReturnValue(null);

      const res = await request(app).get('/dashboard-api/archives/App1/logs/unknown');
      expect(res.status).toBe(404);
    });

    it('POST /dashboard-api/archives/:appName/restore should restore archived logs', async () => {
      (logManager.restoreArchivedLogs as jest.Mock).mockReturnValue({ restored: 2, appName: 'App1' });

      const res = await request(app)
        .post('/dashboard-api/archives/App1/restore')
        .send({ ids: ['a1', 'a2'] });

      expect(res.status).toBe(200);
      expect(res.body.restored).toBe(2);
      expect(logManager.restoreArchivedLogs).toHaveBeenCalledWith('App1', {
        ids: ['a1', 'a2'],
        date: undefined
      });
    });

    it('DELETE /dashboard-api/archives/:appName should delete archive', async () => {
      (logManager.deleteArchivedApp as jest.Mock).mockReturnValue(true);

      const res = await request(app).delete('/dashboard-api/archives/App1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logManager.deleteArchivedApp).toHaveBeenCalledWith('App1', undefined);
    });

    it('DELETE /dashboard-api/archives/:appName?date= should delete specific date folder', async () => {
      (logManager.deleteArchivedApp as jest.Mock).mockReturnValue(true);

      const res = await request(app).delete('/dashboard-api/archives/App1?date=2026-09-19');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(logManager.deleteArchivedApp).toHaveBeenCalledWith('App1', '2026-09-19');
    });

    it('DELETE /dashboard-api/archives/:appName should return 404 if not found', async () => {
      (logManager.deleteArchivedApp as jest.Mock).mockReturnValue(false);

      const res = await request(app).delete('/dashboard-api/archives/UnknownApp');
      expect(res.status).toBe(404);
    });
  });

  describe('SSE Events Feed', () => {
    it('GET /dashboard-api/events should set SSE headers and register/unregister client', () => {
      const req = new EventEmitter() as unknown as express.Request;
      const res = {
        setHeader: jest.fn()
      } as unknown as express.Response;

      const layer = (apiRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown) => void }> } }> })
        .stack.find(s => s.route?.path === '/events');

      expect(layer).toBeDefined();
      const handler = layer!.route!.stack[0]!.handle;

      handler(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(proxyEngine.registerSseClient).toHaveBeenCalledWith(res);

      (req as unknown as EventEmitter).emit('close');
      expect(proxyEngine.unregisterSseClient).toHaveBeenCalledWith(res);
    });
  });
});
