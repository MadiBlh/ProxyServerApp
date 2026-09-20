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
      (configManager.createApplication as jest.Mock).mockReturnValue(newApp);
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
      (configManager.updateApplication as jest.Mock).mockReturnValue(updated);
      (configManager.getApplications as jest.Mock).mockReturnValue([updated]);

      const res = await request(app)
        .put('/dashboard-api/applications/app-1')
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
    });

    it('PUT /dashboard-api/applications/:id should return 404 if app not found', async () => {
      (configManager.updateApplication as jest.Mock).mockReturnValue(null);

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
    it('GET /dashboard-api/logs should return filtered logs', async () => {
      const logs = [{ id: 'l1', endpoint: '/users' }];
      (logManager.getAllLogs as jest.Mock).mockReturnValue(logs);

      const res = await request(app).get('/dashboard-api/logs?appId=app-1&endpoint=users');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(logs);
      expect(logManager.getAllLogs).toHaveBeenCalledWith('app-1', null, {
        endpoint: 'users',
        body: ''
      });
    });

    it('GET /dashboard-api/logs/:id should return log detail', async () => {
      const detail = { id: 'l1', requestBody: 'abc' };
      (logManager.getLogDetail as jest.Mock).mockReturnValue(detail);

      const res = await request(app).get('/dashboard-api/logs/l1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(detail);
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
        archivePath: '/archives/App'
      });

      const res = await request(app)
        .post('/dashboard-api/logs/archive')
        .send({ appId: 'app-1', appName: 'App' });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(3);
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
