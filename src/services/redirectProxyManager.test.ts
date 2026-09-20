import http from 'http';
import httpProxy from 'http-proxy';
import * as redirectProxyManager from './redirectProxyManager';
import type { Application, RedirectSubscriber } from '../types';

jest.mock('http', () => {
  const originalHttp = jest.requireActual('http');
  return {
    ...originalHttp,
    createServer: jest.fn(() => ({
      listen: jest.fn((port, host, cb) => {
        if (cb) cb();
      }),
      close: jest.fn(cb => {
        if (cb) cb();
      })
    }))
  };
});

jest.mock('http-proxy', () => {
  const mockProxy = {
    on: jest.fn(),
    web: jest.fn()
  };
  return {
    __esModule: true,
    default: {
      createProxyServer: jest.fn(() => mockProxy)
    },
    createProxyServer: jest.fn(() => mockProxy)
  };
});

jest.mock('./logManager');

describe('Redirect Proxy Manager (src/services/redirectProxyManager.ts)', () => {
  const appA: Application = {
    id: 'app-a',
    name: 'App A',
    frontEndUrl: 'http://localhost:3000',
    backendUrls: [],
    redirectUrls: [
      { id: 'red-1', name: 'Shared API', targetUrl: 'http://api.external.com', port: 5001 }
    ],
    isActive: true
  };

  const appB: Application = {
    id: 'app-b',
    name: 'App B',
    frontEndUrl: 'http://localhost:3001',
    backendUrls: [],
    redirectUrls: [
      { id: 'red-2', name: 'Shared API', targetUrl: 'http://api.external.com', port: 5001 },
      { id: 'red-3', name: 'Payment API', targetUrl: 'http://pay.external.com', port: 5002 }
    ],
    isActive: true
  };

  let mockProxyInstance: { on: jest.Mock; web: jest.Mock };
  let mockServerInstance: { listen: jest.Mock; close: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    mockProxyInstance = {
      on: jest.fn(),
      web: jest.fn()
    };
    mockServerInstance = {
      listen: jest.fn((_port, _host, cb) => {
        if (cb) cb();
      }),
      close: jest.fn(cb => {
        if (cb) cb();
      }),
      on: jest.fn()
    };

    (httpProxy.createProxyServer as unknown as jest.Mock).mockReturnValue(mockProxyInstance);
    (http.createServer as unknown as jest.Mock).mockReturnValue(mockServerInstance);
    redirectProxyManager.syncRedirectProxies([]);
  });

  afterEach(() => {
    redirectProxyManager.syncRedirectProxies([]);
  });

  describe('resolveSubscriber', () => {
    const subscribers: RedirectSubscriber[] = [
      { app: appA, redirect: appA.redirectUrls[0]! },
      { app: appB, redirect: appB.redirectUrls[0]! }
    ];

    it('should resolve subscriber matching x-proxy-app-id header', () => {
      const req = { headers: { 'x-proxy-app-id': 'app-b' } } as unknown as http.IncomingMessage;
      const sub = redirectProxyManager.resolveSubscriber(subscribers, req);
      expect(sub.app.id).toBe('app-b');
    });

    it('should resolve subscriber matching referer header', () => {
      const req = { headers: { referer: 'http://localhost:3000/dashboard' } } as unknown as http.IncomingMessage;
      const sub = redirectProxyManager.resolveSubscriber(subscribers, req);
      expect(sub.app.id).toBe('app-a');
    });

    it('should fallback to first subscriber when no match', () => {
      const req = { headers: {} } as unknown as http.IncomingMessage;
      const sub = redirectProxyManager.resolveSubscriber(subscribers, req);
      expect(sub.app.id).toBe('app-a');
    });

    it('should handle empty subscribers array safely', () => {
      const req = { headers: {} } as unknown as http.IncomingMessage;
      const sub = redirectProxyManager.resolveSubscriber([], req);
      expect(sub.app.id).toBe('shared');
    });
  });

  describe('syncRedirectProxies & getRunningRedirects', () => {
    it('should create dedicated servers grouped by port and report running redirects', () => {
      redirectProxyManager.syncRedirectProxies([appA, appB]);

      const running = redirectProxyManager.getRunningRedirects();
      // Port 5001 is shared by appA and appB, port 5002 is for appB
      expect(running.length).toBe(2);

      const port5001 = running.find(r => r.port === 5001);
      expect(port5001).toBeDefined();
      expect(port5001?.subscribersCount).toBe(2);
      expect(port5001?.targetUrl).toBe('http://api.external.com');

      const port5002 = running.find(r => r.port === 5002);
      expect(port5002).toBeDefined();
      expect(port5002?.subscribersCount).toBe(1);
    });

    it('should stop proxies for inactive apps or removed ports', () => {
      redirectProxyManager.syncRedirectProxies([appA, appB]);
      expect(redirectProxyManager.getRunningRedirects().length).toBe(2);

      // Remove appB
      redirectProxyManager.syncRedirectProxies([appA]);
      const runningAfter = redirectProxyManager.getRunningRedirects();
      expect(runningAfter.length).toBe(1);
      expect(runningAfter[0]?.port).toBe(5001);
      expect(runningAfter[0]?.subscribersCount).toBe(1);
    });

    it('should stop individual redirect proxy manually', () => {
      redirectProxyManager.syncRedirectProxies([appA]);
      expect(redirectProxyManager.getRunningRedirects().length).toBe(1);

      redirectProxyManager.stopRedirectProxy(5001);
      expect(redirectProxyManager.getRunningRedirects().length).toBe(0);
    });
  });
});
