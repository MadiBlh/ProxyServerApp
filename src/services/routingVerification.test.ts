import http from 'http';
import httpProxy from 'http-proxy';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import * as redirectProxyManager from './redirectProxyManager';
import * as proxyEngine from './proxyEngine';
import * as configManager from './configManager';
import type { Application, RedirectSubscriber } from '../types';

jest.mock('http-proxy', () => {
  const emitter = new EventEmitter();
  const mockProxy = {
    on: jest.fn((event, handler) => emitter.on(event, handler)),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
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

jest.mock('./configManager');
jest.mock('./logManager');

describe('Core Redirection & Routing Collision Verification', () => {
  const appA: Application = {
    id: 'app-a',
    name: 'Application A',
    frontEndUrl: 'http://localhost:3000',
    backendUrls: [
      { id: 'be-a', name: 'App A Backend', url: 'http://localhost:5001', pathPrefix: '/api' }
    ],
    redirectUrls: [
      { id: 'red-a', name: 'Stripe API A', targetUrl: 'https://api.stripe.com', port: 4001 }
    ],
    isActive: true
  };

  const appB: Application = {
    id: 'app-b',
    name: 'Application B',
    frontEndUrl: 'http://localhost:3001',
    backendUrls: [
      { id: 'be-b', name: 'App B Backend', url: 'http://localhost:5002', pathPrefix: '/api' }
    ],
    redirectUrls: [
      { id: 'red-b', name: 'Stripe API B', targetUrl: 'https://api.stripe.com', port: 4001 }
    ],
    isActive: true
  };

  const appC: Application = {
    id: 'app-c',
    name: 'Application C (Subpath API)',
    frontEndUrl: 'http://localhost:3002',
    backendUrls: [
      { id: 'be-c', name: 'App C V2 Backend', url: 'http://localhost:5003', pathPrefix: '/api/v2' }
    ],
    redirectUrls: [
      { id: 'red-c', name: 'Stripe API V1 Path', targetUrl: 'https://api.stripe.com/v1', port: 4002 }
    ],
    isActive: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // SCENARIO 1: Shared Redirect Port Subscriber Resolution & Log Attribution
  // =========================================================================
  describe('Scenario 1: Shared Redirect Port Subscriber Resolution', () => {
    const subscribers: RedirectSubscriber[] = [
      { app: appA, redirect: appA.redirectUrls[0]! },
      { app: appB, redirect: appB.redirectUrls[0]! }
    ];

    it('1A: Should correctly attribute to App B when explicit x-proxy-app-id is sent', () => {
      const req = {
        headers: { 'x-proxy-app-id': 'app-b' }
      } as unknown as http.IncomingMessage;

      const subscriber = redirectProxyManager.resolveSubscriber(subscribers, req);
      expect(subscriber.app.id).toBe('app-b');
      expect(subscriber.app.name).toBe('Application B');
    });

    it('1B: Should correctly attribute to App B when Referer header matches App B frontend', () => {
      const req = {
        headers: { referer: 'http://localhost:3001/checkout' }
      } as unknown as http.IncomingMessage;

      const subscriber = redirectProxyManager.resolveSubscriber(subscribers, req);
      expect(subscriber.app.id).toBe('app-b');
      expect(subscriber.app.name).toBe('Application B');
    });

    it('1C: Demonstrates Misattribution Risk: falls back to App A for anonymous curl / backend calls without headers', () => {
      const req = {
        headers: {} // No referer, no x-proxy-app-id
      } as unknown as http.IncomingMessage;

      const subscriber = redirectProxyManager.resolveSubscriber(subscribers, req);
      // Because App A is the first subscriber in the array, it receives the log attribution
      expect(subscriber.app.id).toBe('app-a');
      expect(subscriber.app.name).toBe('Application A');
    });
  });

  // =========================================================================
  // SCENARIO 2: PathPrefix Collisions & Shadowing in Main Reverse Proxy
  // =========================================================================
  describe('Scenario 2: PathPrefix Shadowing on Port 4000', () => {
    const createMockReqRes = (url: string, headers: Record<string, string> = {}) => {
      const reqEmitter = new EventEmitter();
      const req = Object.assign(reqEmitter, {
        url,
        originalUrl: url,
        method: 'GET',
        headers,
        params: {},
        query: {}
      }) as unknown as Request;

      const res = {
        statusCode: 200,
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        setHeader: jest.fn()
      } as unknown as Response;

      const next = jest.fn() as NextFunction;
      return { req, res, next };
    };

    it('2A: Demonstrates Path Shadowing: When two apps share identical /api prefix, first in list wins if no app header is sent', () => {
      (configManager.getApplications as jest.Mock).mockReturnValue([appA, appB]);

      const { req, res, next } = createMockReqRes('/api/users');
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      // Request was routed to App A's backend (5001) because App A was first in activeApps
      expect(req._proxyApp?.id).toBe('app-a');
      expect(req._proxyTargetUrl).toBe('http://localhost:5001');
    });

    it('2B: Disambiguation: Explicit x-app-id header routes to the intended app despite collision', () => {
      (configManager.getApplications as jest.Mock).mockReturnValue([appA, appB]);

      const { req, res, next } = createMockReqRes('/api/users', { 'x-app-id': 'app-b' });
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      // Correctly routed to App B (5002)
      expect(req._proxyApp?.id).toBe('app-b');
      expect(req._proxyTargetUrl).toBe('http://localhost:5002');
    });

    it('2C: Longest Prefix Priority: More specific /api/v2 route is prioritized over generic /api', () => {
      (configManager.getApplications as jest.Mock).mockReturnValue([appA, appB, appC]);

      const { req, res, next } = createMockReqRes('/api/v2/orders');
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      // /api/v2 belongs to App C (5003), so it wins over App A's /api
      expect(req._proxyApp?.id).toBe('app-c');
      expect(req._proxyTargetUrl).toBe('http://localhost:5003');
    });
  });

  // =========================================================================
  // SCENARIO 3: Port Assignment & Collision Probing
  // =========================================================================
  describe('Scenario 3: Port Assignment & Collision Rules', () => {
    // Un-mock configManager.assignRedirectPort and configManager.normalizeTargetUrl for testing pure logic
    const { assignRedirectPort, normalizeTargetUrl } = jest.requireActual('./configManager');

    it('3A: Reuses port when two redirect entries share the exact same targetUrl', () => {
      const port = assignRedirectPort(
        undefined,
        'https://api.stripe.com/',
        [appA],
        'app-b',
        'red-b'
      );
      // Reuses appA's port 4001
      expect(port).toBe(4001);
    });

    it('3B: Assigns distinct ports for different target URLs', () => {
      const port = assignRedirectPort(
        undefined,
        'https://api.paypal.com',
        [appA, appC],
        'app-d',
        'red-d'
      );
      // 4000 (main), 4001 (stripe), 4002 (stripe/v1) are taken -> next is 4003
      expect(port).toBe(4003);
    });

    it('3C: Never assigns MAIN_SERVER_PORT (4000)', () => {
      const port = assignRedirectPort(
        4000, // Try requesting port 4000
        'https://api.custom.com',
        [],
        'app-test',
        'red-test'
      );
      // Must not assign 4000, should give 4001 or higher
      expect(port).not.toBe(4000);
      expect(port).toBeGreaterThanOrEqual(4001);
    });

    it('3D: Target URL Normalization trims trailing slashes and handles case sensitivity', () => {
      expect(normalizeTargetUrl('https://API.Stripe.COM/')).toBe('https://api.stripe.com');
      expect(normalizeTargetUrl('http://localhost:8080/api/')).toBe('http://localhost:8080/api');
    });
  });
});
