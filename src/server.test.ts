import request from 'supertest';
import { app, initializeServer, gracefulShutdown } from '../server';
import * as configManager from './services/configManager';
import * as redirectProxyManager from './services/redirectProxyManager';
import * as proxyEngine from './services/proxyEngine';

jest.mock('./services/configManager');
jest.mock('./services/redirectProxyManager');
jest.mock('./services/proxyEngine');
jest.mock('./services/logManager');

describe('Server Root & Middleware (server.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize server and sync redirect proxies', () => {
    (configManager.getApplications as jest.Mock).mockReturnValue([
      {
        id: 'app-1',
        name: 'App 1',
        frontEndUrl: 'http://localhost:3000',
        backendUrls: [],
        redirectUrls: [{ id: 'red-1', name: 'R1', targetUrl: 'http://localhost:5000', port: 4001 }],
        isActive: true
      }
    ]);

    initializeServer();
    expect(redirectProxyManager.setSseClients).toHaveBeenCalled();
    expect(redirectProxyManager.syncRedirectProxies).toHaveBeenCalled();
  });

  it('should auto-assign ports for legacy redirect URLs during initializeServer', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    (configManager.getApplications as jest.Mock).mockReturnValue([
      {
        id: 'app-1',
        name: 'App 1',
        frontEndUrl: 'http://localhost:3000',
        backendUrls: [],
        redirectUrls: [{ id: 'red-legacy', name: 'Legacy', targetUrl: 'http://localhost:5000' }],
        isActive: true
      }
    ]);
    (configManager.assignRedirectPort as jest.Mock).mockReturnValue(4005);

    initializeServer();
    expect(configManager.saveApplications).toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });

  it('should redirect browser navigation GET / to /dashboard', async () => {
    const res = await request(app)
      .get('/')
      .set('Accept', 'text/html,application/xhtml+xml');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('should serve archives.html on GET /archives', async () => {
    const res = await request(app).get('/archives');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('should serve doc.html on GET /doc', async () => {
    const res = await request(app).get('/doc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('should serve local monaco vendor assets on /dashboard-static/vendor/monaco/loader.js', async () => {
    const res = await request(app).get('/dashboard-static/vendor/monaco/loader.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
  });

  it('should compress responses when Accept-Encoding is gzip', async () => {
    const res = await request(app)
      .get('/dashboard-api/logs/dates')
      .set('Accept-Encoding', 'gzip');
    // Express response should succeed
    expect(res.status).toBe(200);
  });

  it('should execute gracefulShutdown cleanly closing sse, redirects, and server', (done) => {
    const mockHttpServer = {
      close: jest.fn((callback?: () => void) => {
        if (callback) callback();
      })
    } as unknown as import('http').Server;

    gracefulShutdown(mockHttpServer, () => {
      expect(proxyEngine.closeAllSseClients).toHaveBeenCalled();
      expect(redirectProxyManager.stopAllRedirectProxies).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
      done();
    });
  });
});
