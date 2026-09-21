import '../utils/bootstrap';
import httpProxy from 'http-proxy';
import { PassThrough } from 'stream';
import type { Request, Response, NextFunction } from 'express';
import type * as http from 'http';
import uuidv4 from '../utils/uuid';
import { extractBodyString } from '../utils/payload';
import * as configManager from './configManager';
import * as logManager from './logManager';
import * as mockManager from './mockManager';
import type { SseClient, Application } from '../types';

// Create http-proxy instance with selfHandleResponse set to true and cookie rewrite support
const proxy = httpProxy.createProxyServer({
  selfHandleResponse: true,
  changeOrigin: true,
  secure: false,
  // Remove the Domain attribute from all Set-Cookie headers so the browser
  // scopes each cookie to the current host (localhost) automatically.
  cookieDomainRewrite: { '*': '' }
});

// Real-time clients array for SSE updates
export const sseClients: SseClient[] = [];

export function registerSseClient(res: Response): void {
  sseClients.push(res);
}

export function unregisterSseClient(res: Response): void {
  const idx = sseClients.indexOf(res);
  if (idx !== -1) sseClients.splice(idx, 1);
}

export function closeAllSseClients(): void {
  while (sseClients.length > 0) {
    const client = sseClients.pop();
    if (client) {
      try {
        client.end();
      } catch {
        // client already closed
      }
    }
  }
}

function broadcastLogEvent(logSummary: object): void {
  const data = `data: ${JSON.stringify(logSummary)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(data);
    } catch {
      // client disconnected
    }
  });
}

// Handle response interception
proxy.on('proxyRes', (proxyRes: http.IncomingMessage, req: http.IncomingMessage, res: http.ServerResponse) => {
  const expressReq = req as Request;
  const expressRes = res as Response;

  const startTime = expressReq._proxyStartTime || Date.now();
  const durationMs = Date.now() - startTime;
  const requestId = expressReq._proxyRequestId!;
  const app = expressReq._proxyApp!;
  const targetUrl = expressReq._proxyTargetUrl!;

  const responseHeaders = proxyRes.headers;
  const statusCode = proxyRes.statusCode ?? 500;

  const bodyChunks: Buffer[] = [];

  proxyRes.on('data', (chunk: Buffer) => {
    bodyChunks.push(chunk);
  });

  proxyRes.on('end', () => {
    const responseBuffer = Buffer.concat(bodyChunks);
    const responseBodyStr = extractBodyString(bodyChunks);

    // Save log entry to files (logs/ & headers/)
    const { reqMeta, resMeta } = logManager.saveLogEntry({
      id: requestId,
      appId: app.id,
      appName: app.name,
      backendName: expressReq._proxyBackendService
        ? expressReq._proxyBackendService.name
        : null,
      routeType: expressReq._proxyBackendService
        ? expressReq._proxyBackendService.routeType
        : 'backend',
      targetUrl,
      method: req.method || 'GET',
      endpoint: req.url || '/',
      requestHeaders: req.headers,
      requestBody: expressReq._proxyRawBodyStr || '',
      statusCode,
      responseHeaders: responseHeaders as Record<string, string | string[] | undefined>,
      responseBody: responseBodyStr,
      durationMs
    });

    // Broadcast SSE log event to frontend
    broadcastLogEvent({
      id: requestId,
      appId: app.id,
      appName: app.name,
      backendName: expressReq._proxyBackendService
        ? expressReq._proxyBackendService.name
        : undefined,
      routeType: expressReq._proxyBackendService
        ? expressReq._proxyBackendService.routeType
        : 'backend',
      timestamp: reqMeta.timestamp,
      method: req.method,
      endpoint: req.url,
      statusCode,
      status: resMeta.statusText,
      durationMs
    });

    // Forward original target headers and status to client
    expressRes.status(statusCode);
    Object.keys(responseHeaders).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-length' || lowerKey === 'transfer-encoding') {
        return;
      }
      try {
        expressRes.setHeader(key, responseHeaders[key] as string | string[]);
      } catch (err) {
        console.warn(`Could not set response header ${key}:`, (err as Error).message);
      }
    });
    expressRes.end(responseBuffer);
  });
});

proxy.on('error', (err: Error, req: http.IncomingMessage, res: http.ServerResponse | import('net').Socket) => {
  console.error('Proxy Error:', err.message);
  const expressReq = req as Request;
  const expressRes = res as Response;

  const startTime = expressReq._proxyStartTime || Date.now();
  const durationMs = Date.now() - startTime;
  const requestId = expressReq._proxyRequestId || uuidv4();
  const app: Application = expressReq._proxyApp || { id: 'unknown', name: 'Unknown', frontEndUrl: '', backendUrls: [], redirectUrls: [], isActive: false };

  logManager.saveLogEntry({
    id: requestId,
    appId: app.id,
    appName: app.name,
    targetUrl: expressReq._proxyTargetUrl || req.url || '/',
    method: req.method || 'GET',
    endpoint: req.url || '/',
    requestHeaders: req.headers,
    requestBody: expressReq._proxyRawBodyStr || '',
    statusCode: 502,
    responseHeaders: { 'content-type': 'text/plain' },
    responseBody: `Proxy Connection Error: ${err.message}`,
    durationMs,
    error: err.message
  });

  if (!expressRes.headersSent) {
    expressRes.status(502).json({
      error: 'Proxy Target Connection Failed',
      details: err.message
    });
  }
});

/** Middleware for intercepting proxy requests */
export function proxyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Capture raw request body first
  const reqChunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    reqChunks.push(chunk);
  });

  req.on('end', () => {
    const rawReqBuffer = Buffer.concat(reqChunks);
    req._proxyRawBodyStr = extractBodyString(reqChunks);
    req._proxyRawBuffer = rawReqBuffer;

    // 1. Determine request path
    let requestPath = req.originalUrl || req.url;

    // If using explicit /proxy/:appId route, strip prefix
    if (req.params && req.params['appId']) {
      const routePrefix = `/proxy/${req.params['appId']}`;
      if (requestPath.startsWith(routePrefix)) {
        requestPath = requestPath.substring(routePrefix.length) || '/';
      }
    }
    req.url = requestPath;

    const apps = configManager.getApplications();
    const activeApps = apps.filter(a => a.isActive);

    if (activeApps.length === 0) {
      res.status(404).json({
        error: 'No active web applications configured. Please create an application in the dashboard.'
      });
      return;
    }

    let targetApp: Application | null = null;
    let selectedBackend: (Application['backendUrls'][0] & { routeType: 'backend' | 'redirect'; url: string }) | null = null;

    // Check if explicit appId header/param/query is provided
    const explicitAppId =
      (req.params && req.params['appId']) ||
      req.headers['x-proxy-app-id'] ||
      req.headers['x-app-id'] ||
      (req.query && (req.query['_appId'] as string));

    if (explicitAppId) {
      targetApp = activeApps.find(a => a.id === explicitAppId) || null;
      if (targetApp) {
        const routes = [
          ...targetApp.backendUrls.map(b => ({ ...b, url: b.url, routeType: 'backend' as const })),
          ...targetApp.redirectUrls.map(r => ({ ...r, url: r.targetUrl, pathPrefix: '', routeType: 'redirect' as const }))
        ].sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);
        selectedBackend =
          routes.find(
            be => (be.pathPrefix || '').trim() && requestPath.startsWith((be.pathPrefix || '').trim())
          ) || routes[0] || null;
      }
    }

    // If no explicit app ID, search ALL active backend routes across ALL active apps by pathPrefix
    if (!selectedBackend) {
      const allActiveRoutes: Array<Application['backendUrls'][0] & { routeType: 'backend'; url: string; app: Application }> = [];
      for (const app of activeApps) {
        for (const be of app.backendUrls) {
          if (be.url) {
            allActiveRoutes.push({ ...be, url: be.url, routeType: 'backend', app });
          }
        }
      }

      allActiveRoutes.sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);

      const match = allActiveRoutes.find(be => {
        const prefix = (be.pathPrefix || '/').trim() || '/';
        return requestPath.startsWith(prefix);
      });

      if (match) {
        selectedBackend = match;
        targetApp = match.app;
      }
    }

    // Fallback: try matching Referer/Origin or use first active backend
    if (!selectedBackend) {
      const referer = (
        req.headers['referer'] || req.headers['origin'] || ''
      ).toString().toLowerCase();
      if (referer) {
        const appMatch = activeApps.find(app => {
          if (!app.frontEndUrl) return false;
          const cleanFront = app.frontEndUrl
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '');
          return referer.includes(cleanFront);
        });
        if (appMatch && appMatch.backendUrls.length > 0) {
          targetApp = appMatch;
          selectedBackend = { ...appMatch.backendUrls[0]!, routeType: 'backend', url: appMatch.backendUrls[0]!.url };
        }
      }
    }

    if (!selectedBackend || !targetApp) {
      const configuredPrefixes = activeApps
        .flatMap(a => a.backendUrls.map(b => `'${b.pathPrefix}' (${a.name} → ${b.url})`))
        .join(', ');
      res.status(404).json({
        error: `No backend service matched path '${requestPath}'. Please check pathPrefix configuration in the dashboard.`,
        configuredPrefixes: configuredPrefixes || 'None'
      });
      return;
    }

    const targetBackendUrl = selectedBackend.url;
    req._proxyRequestId = uuidv4();
    req._proxyStartTime = Date.now();
    req._proxyApp = targetApp;
    req._proxyBackendService = selectedBackend;
    req._proxyTargetUrl = targetBackendUrl;

    // Check for matching mock interception rules
    const mockRule = mockManager.findMatchingMockRule({
      appId: targetApp.id,
      method: req.method,
      url: requestPath,
      targetUrl: targetBackendUrl
    });

    if (mockRule) {
      const executeMock = async () => {
        if (mockRule.delayMs && mockRule.delayMs > 0) {
          await new Promise(r => setTimeout(r, mockRule.delayMs));
        }

        const durationMs = Date.now() - (req._proxyStartTime || Date.now());
        const mockStatusCode = mockRule.statusCode || 200;
        const mockHeaders = mockRule.headers || { 'content-type': mockRule.contentType || 'application/json' };
        const mockBodyStr = mockRule.body || '';

        const { reqMeta, resMeta } = logManager.saveLogEntry({
          id: req._proxyRequestId!,
          appId: targetApp.id,
          appName: targetApp.name,
          backendName: selectedBackend ? `[MOCK] ${selectedBackend.name}` : `[MOCK] ${mockRule.name}`,
          routeType: 'mock',
          targetUrl: targetBackendUrl,
          method: req.method || 'GET',
          endpoint: requestPath,
          requestHeaders: req.headers,
          requestBody: req._proxyRawBodyStr || '',
          statusCode: mockStatusCode,
          responseHeaders: mockHeaders as Record<string, string | string[] | undefined>,
          responseBody: mockBodyStr,
          durationMs
        });

        broadcastLogEvent({
          id: req._proxyRequestId!,
          appId: targetApp.id,
          appName: targetApp.name,
          backendName: `[MOCK] ${mockRule.name}`,
          routeType: 'mock',
          timestamp: reqMeta.timestamp,
          method: req.method,
          endpoint: requestPath,
          statusCode: mockStatusCode,
          status: resMeta.statusText || 'MOCK',
          durationMs
        });

        res.status(mockStatusCode);
        Object.keys(mockHeaders).forEach(key => {
          try {
            res.setHeader(key, mockHeaders[key] as string);
          } catch { /* ignore */ }
        });
        res.send(mockBodyStr);
      };

      executeMock().catch(err => {
        console.error('[MockEngine] Error executing mock rule:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Mock Rule Execution Error', details: (err as Error).message });
        }
      });
      return;
    }

    // Re-stream buffered body for http-proxy
    const bufferStream = new PassThrough();
    bufferStream.end(rawReqBuffer);

    proxy.web(req, res, {
      target: targetBackendUrl,
      buffer: bufferStream
    });
  });
}
