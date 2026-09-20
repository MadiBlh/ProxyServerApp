import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import * as redirectProxyManager from './redirectProxyManager';
import * as logManager from './logManager';
import type { Application, SseClient } from '../types';

describe('External Redirection Proxy E2E Live Verification', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let targetUrl: string;
  let redirectPort: number;

  const savedLogEntries: unknown[] = [];
  const broadcastMessages: string[] = [];

  const mockSseClient: SseClient = {
    write: (data: string) => {
      broadcastMessages.push(data);
      return true;
    }
  } as unknown as SseClient;

  beforeAll((done) => {
    // 1. Create a real target mock API server
    const targetApp = express();
    targetApp.use(express.json());
    targetApp.use(express.urlencoded({ extended: true }));

    // Echo endpoint returning query, headers, body, method, path
    targetApp.all('*', (req, res) => {
      if (req.path === '/error-500') {
        res.status(500).json({ error: 'Internal External Error' });
        return;
      }
      res.status(req.method === 'POST' ? 201 : 200)
        .setHeader('X-External-Custom-Header', 'ExternalResponseValue')
        .setHeader('Set-Cookie', 'sessionId=abc123; Domain=external.test; Path=/')
        .json({
          method: req.method,
          path: req.path,
          query: req.query,
          headers: req.headers,
          body: req.body,
          timestamp: Date.now()
        });
    });

    targetServer = targetApp.listen(0, '127.0.0.1', () => {
      targetPort = (targetServer.address() as AddressInfo).port;
      targetUrl = `http://127.0.0.1:${targetPort}`;
      done();
    });
  });

  afterAll((done) => {
    redirectProxyManager.stopAllRedirectProxies();
    targetServer.close(() => done());
  });

  beforeEach((done) => {
    savedLogEntries.length = 0;
    broadcastMessages.length = 0;
    redirectProxyManager.setSseClients([mockSseClient]);

    jest.spyOn(logManager, 'saveLogEntry').mockImplementation((entry) => {
      savedLogEntries.push(entry);
      return {
        id: entry.id,
        reqMeta: { id: entry.id, timestamp: new Date().toISOString() } as any,
        resMeta: { status: entry.statusCode, statusText: 'OK' } as any
      };
    });

    // Pick an available ephemeral port for the redirect proxy
    const tempServer = http.createServer();
    tempServer.listen(0, '127.0.0.1', () => {
      redirectPort = (tempServer.address() as AddressInfo).port;
      tempServer.close(() => done());
    });
  });

  afterEach(() => {
    redirectProxyManager.stopRedirectProxy(redirectPort);
    jest.restoreAllMocks();
  });

  it('correctly redirects GET requests with query params, headers, and captures response', async () => {
    const testApp: Application = {
      id: 'app-e2e',
      name: 'E2E Test App',
      frontEndUrl: 'http://localhost:3000',
      backendUrls: [],
      redirectUrls: [
        { id: 'red-1', name: 'Target Service', targetUrl, port: redirectPort }
      ],
      isActive: true
    };

    redirectProxyManager.syncRedirectProxies([testApp]);

    // Give proxy server a moment to start listening
    await new Promise((r) => setTimeout(r, 50));

    // Make request to redirect proxy port
    const res = await fetch(`http://127.0.0.1:${redirectPort}/api/v1/users?search=alice&limit=10`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Client-Custom': 'ClientTestValue'
      }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-external-custom-header')).toBe('ExternalResponseValue');

    const data = (await res.json()) as any;
    expect(data.method).toBe('GET');
    expect(data.path).toBe('/api/v1/users');
    expect(data.query).toEqual({ search: 'alice', limit: '10' });
    expect(data.headers['x-client-custom']).toBe('ClientTestValue');

    // Verify logManager recorded the transaction
    expect(savedLogEntries.length).toBe(1);
    const log = savedLogEntries[0] as any;
    expect(log.appId).toBe('app-e2e');
    expect(log.appName).toBe('E2E Test App');
    expect(log.backendName).toBe('Target Service');
    expect(log.routeType).toBe('redirect');
    expect(log.targetUrl).toBe(targetUrl);
    expect(log.statusCode).toBe(200);
    expect(log.endpoint).toBe('/api/v1/users?search=alice&limit=10');

    // Verify SSE broadcast
    expect(broadcastMessages.length).toBe(1);
    expect(broadcastMessages[0]).toContain('"appId":"app-e2e"');
  });

  it('correctly redirects POST requests with JSON body and forwards status 201', async () => {
    const testApp: Application = {
      id: 'app-e2e',
      name: 'E2E Test App',
      frontEndUrl: 'http://localhost:3000',
      backendUrls: [],
      redirectUrls: [
        { id: 'red-1', name: 'Target Service', targetUrl, port: redirectPort }
      ],
      isActive: true
    };

    redirectProxyManager.syncRedirectProxies([testApp]);
    await new Promise((r) => setTimeout(r, 50));

    const postPayload = { username: 'testuser', role: 'admin', active: true };
    const res = await fetch(`http://127.0.0.1:${redirectPort}/auth/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': 'secret-token-123'
      },
      body: JSON.stringify(postPayload)
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.method).toBe('POST');
    expect(data.path).toBe('/auth/create-user');
    expect(data.body).toEqual(postPayload);

    // Verify payload was logged
    expect(savedLogEntries.length).toBe(1);
    const log = savedLogEntries[0] as any;
    expect(log.method).toBe('POST');
    expect(log.statusCode).toBe(201);
    expect(log.requestBody).toBe(JSON.stringify(postPayload));
  });

  it('correctly handles error 500 responses from external target', async () => {
    const testApp: Application = {
      id: 'app-e2e',
      name: 'E2E Test App',
      frontEndUrl: 'http://localhost:3000',
      backendUrls: [],
      redirectUrls: [
        { id: 'red-1', name: 'Target Service', targetUrl, port: redirectPort }
      ],
      isActive: true
    };

    redirectProxyManager.syncRedirectProxies([testApp]);
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${redirectPort}/error-500`);
    expect(res.status).toBe(500);

    const data = (await res.json()) as any;
    expect(data.error).toBe('Internal External Error');

    expect(savedLogEntries.length).toBe(1);
    const log = savedLogEntries[0] as any;
    expect(log.statusCode).toBe(500);
  });

  it('correctly returns 502 when target server is down/unreachable', async () => {
    // Suppress expected console.error in test output for intentional connection failure
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Use an unallocated port where no server is running
    const deadTargetUrl = 'http://127.0.0.1:59999';

    const testApp: Application = {
      id: 'app-e2e',
      name: 'E2E Test App',
      frontEndUrl: 'http://localhost:3000',
      backendUrls: [],
      redirectUrls: [
        { id: 'red-dead', name: 'Dead Service', targetUrl: deadTargetUrl, port: redirectPort }
      ],
      isActive: true
    };

    redirectProxyManager.syncRedirectProxies([testApp]);
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${redirectPort}/some-endpoint`);
    expect(res.status).toBe(502);

    const data = (await res.json()) as any;
    expect(data.error).toBe('Redirect Proxy Error');

    expect(savedLogEntries.length).toBe(1);
    const log = savedLogEntries[0] as any;
    expect(log.statusCode).toBe(502);
    expect(log.error).toBeDefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
