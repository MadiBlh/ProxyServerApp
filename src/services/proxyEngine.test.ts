import httpProxy from 'http-proxy';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import * as proxyEngine from './proxyEngine';
import * as configManager from './configManager';
import * as logManager from './logManager';
import type { Application } from '../types';

jest.mock('http-proxy', () => {
  const emitter = new EventEmitter();
  const mockProxy = {
    on: jest.fn((event, handler) => emitter.on(event, handler)),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    web: jest.fn()
  };
  return {
    createProxyServer: jest.fn(() => mockProxy)
  };
});

jest.mock('./configManager');
jest.mock('./logManager');

describe('Proxy Engine (src/services/proxyEngine.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    proxyEngine.sseClients.length = 0;
  });

  describe('SSE Client Management', () => {
    it('should register and unregister SSE clients', () => {
      const mockRes = { write: jest.fn() } as unknown as Response;

      proxyEngine.registerSseClient(mockRes);
      expect(proxyEngine.sseClients).toContain(mockRes);

      proxyEngine.unregisterSseClient(mockRes);
      expect(proxyEngine.sseClients).not.toContain(mockRes);
    });
  });

  describe('proxyMiddleware', () => {
    const createMockReqRes = (url: string, headers: Record<string, string> = {}, body = '') => {
      const reqEmitter = new EventEmitter();
      const req = Object.assign(reqEmitter, {
        url,
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

      return { req, res, next, body };
    };

    it('should respond 404 if no active applications exist', () => {
      (configManager.getApplications as jest.Mock).mockReturnValue([]);

      const { req, res, next } = createMockReqRes('/api/users');
      proxyEngine.proxyMiddleware(req, res, next);

      // Trigger req data and end
      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it('should respond 404 if no backend service matches path', () => {
      const mockApps: Application[] = [
        {
          id: 'app-1',
          name: 'App 1',
          frontEndUrl: 'http://localhost:3000',
          backendUrls: [
            { id: 'b1', name: 'Users Service', url: 'http://backend.local', pathPrefix: '/users' }
          ],
          redirectUrls: [],
          isActive: true
        }
      ];
      (configManager.getApplications as jest.Mock).mockReturnValue(mockApps);

      const { req, res, next } = createMockReqRes('/unmatched/path');
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('No backend service matched') })
      );
    });

    it('should route request to matching backend by pathPrefix', () => {
      const mockApps: Application[] = [
        {
          id: 'app-main',
          name: 'Main App',
          frontEndUrl: 'http://localhost:3000',
          backendUrls: [
            { id: 'b1', name: 'Auth API', url: 'http://auth.service.internal', pathPrefix: '/api/auth' },
            { id: 'b2', name: 'Catalog API', url: 'http://catalog.service.internal', pathPrefix: '/api/catalog' }
          ],
          redirectUrls: [],
          isActive: true
        }
      ];
      (configManager.getApplications as jest.Mock).mockReturnValue(mockApps);

      const { req, res, next } = createMockReqRes('/api/catalog/products/123');
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      expect(req._proxyTargetUrl).toBe('http://catalog.service.internal');
      expect(req._proxyApp?.id).toBe('app-main');
      expect(req._proxyRequestId).toBeDefined();
    });

    it('should prioritize explicit x-proxy-app-id header', () => {
      const mockApps: Application[] = [
        {
          id: 'app-1',
          name: 'App 1',
          frontEndUrl: 'http://localhost:3000',
          backendUrls: [
            { id: 'b1', name: 'App1 API', url: 'http://app1.internal', pathPrefix: '/api' }
          ],
          redirectUrls: [],
          isActive: true
        },
        {
          id: 'app-2',
          name: 'App 2',
          frontEndUrl: 'http://localhost:3001',
          backendUrls: [
            { id: 'b2', name: 'App2 API', url: 'http://app2.internal', pathPrefix: '/api' }
          ],
          redirectUrls: [],
          isActive: true
        }
      ];
      (configManager.getApplications as jest.Mock).mockReturnValue(mockApps);

      const { req, res, next } = createMockReqRes('/api/data', { 'x-proxy-app-id': 'app-2' });
      proxyEngine.proxyMiddleware(req, res, next);

      (req as unknown as EventEmitter).emit('data', Buffer.from(''));
      (req as unknown as EventEmitter).emit('end');

      expect(req._proxyTargetUrl).toBe('http://app2.internal');
      expect(req._proxyApp?.id).toBe('app-2');
    });
  });
});
