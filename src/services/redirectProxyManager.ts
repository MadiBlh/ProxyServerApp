import '../utils/bootstrap';
import http from 'http';
import express from 'express';
import cors from 'cors';
import httpProxy from 'http-proxy';
import { PassThrough } from 'stream';
import type { Request, Response } from 'express';
import type * as httpModule from 'http';
import uuidv4 from '../utils/uuid';
import { extractBodyString } from '../utils/payload';
import * as logManager from './logManager';
import type { RedirectSubscriber, ProxyEntry, SseClient, RunningRedirectProxy } from '../types';

/* ==========================================================================
   REDIRECT PROXY MANAGER
   Manages dedicated HTTP proxy servers per configured redirect port.
   If multiple web applications define the same external target URL,
   they share the same proxy server port seamlessly without port collision.
   ========================================================================== */

// Map of port (number) -> { server, proxy, port, targetUrl, subscribers }
interface RunningProxyEntry extends ProxyEntry {
  server: http.Server;
  proxy: httpProxy;
}

const runningProxies = new Map<number, RunningProxyEntry>();

// SSE clients shared with the main proxy engine for the unified log feed
let sseClients: SseClient[] = [];

export function setSseClients(clients: SseClient[]): void {
  sseClients = clients;
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

/**
 * Resolves the most relevant subscriber app for an incoming request on a shared redirect port.
 */
export function resolveSubscriber(
  subscribers: RedirectSubscriber[],
  req: Request | httpModule.IncomingMessage
): RedirectSubscriber {
  if (!subscribers || subscribers.length === 0) {
    return {
      app: {
        id: 'shared',
        name: 'Shared API Redirect',
        frontEndUrl: '',
        backendUrls: [],
        redirectUrls: [],
        isActive: true
      },
      redirect: { id: 'shared', name: 'External API', targetUrl: '', port: 0 }
    };
  }

  const headers = req.headers;

  // 1. Check explicit header
  const explicitAppId = headers['x-proxy-app-id'] || headers['x-app-id'];
  if (explicitAppId) {
    const appIdStr = Array.isArray(explicitAppId) ? explicitAppId[0] : explicitAppId;
    const match = subscribers.find(s => s.app.id === appIdStr);
    if (match) return match;
  }

  // 2. Check Referer or Origin header against frontend URLs
  const refererRaw = headers['referer'] || headers['origin'] || '';
  const referer = (Array.isArray(refererRaw) ? refererRaw[0] : refererRaw).toLowerCase();
  if (referer) {
    const match = subscribers.find(s => {
      if (!s.app.frontEndUrl) return false;
      const cleanFront = s.app.frontEndUrl
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      return referer.includes(cleanFront);
    });
    if (match) return match;
  }

  // 3. Fallback: First subscriber
  return subscribers[0]!;
}

/**
 * Starts a dedicated proxy server on a specific port for a target URL.
 */
export function startRedirectProxy(
  port: number,
  targetUrl: string,
  subscribers: RedirectSubscriber[]
): void {
  if (runningProxies.has(port)) {
    stopRedirectProxy(port);
  }

  if (!targetUrl || !port) {
    console.warn(`[RedirectProxy] Skipping start on port ${port} — missing targetUrl or port`);
    return;
  }

  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
    cookieDomainRewrite: { '*': '' }
  });

  // Response handler: buffer, log, forward
  proxy.on('proxyRes', (proxyRes: httpModule.IncomingMessage, req: httpModule.IncomingMessage, res: httpModule.ServerResponse) => {
    const expressReq = req as Request;
    const expressRes = res as Response;

    const startTime = expressReq._redirectStartTime || Date.now();
    const durationMs = Date.now() - startTime;
    const requestId = expressReq._redirectRequestId!;
    const subscriber =
      expressReq._redirectSubscriber || resolveSubscriber(subscribers, req);
    const responseHeaders = proxyRes.headers;
    const statusCode = proxyRes.statusCode ?? 500;

    const bodyChunks: Buffer[] = [];
    proxyRes.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    proxyRes.on('end', () => {
      const responseBuffer = Buffer.concat(bodyChunks);
      const responseBodyStr = extractBodyString(bodyChunks);

      const { reqMeta, resMeta } = logManager.saveLogEntry({
        id: requestId,
        appId: subscriber.app.id,
        appName: subscriber.app.name,
        backendName: subscriber.redirect.name,
        routeType: 'redirect',
        targetUrl,
        method: req.method || 'GET',
        endpoint: req.url || '/',
        requestHeaders: req.headers,
        requestBody: expressReq._redirectRawBodyStr || '',
        statusCode,
        responseHeaders: responseHeaders as Record<string, string | string[] | undefined>,
        responseBody: responseBodyStr,
        durationMs
      });

      broadcastLogEvent({
        id: requestId,
        appId: subscriber.app.id,
        appName: subscriber.app.name,
        backendName: subscriber.redirect.name,
        routeType: 'redirect',
        timestamp: reqMeta.timestamp,
        method: req.method,
        endpoint: req.url,
        statusCode,
        status: resMeta.statusText,
        durationMs
      });

      expressRes.status(statusCode);
      Object.keys(responseHeaders).forEach(key => {
        const lk = key.toLowerCase();
        if (lk === 'content-length' || lk === 'transfer-encoding') return;
        try {
          expressRes.setHeader(key, responseHeaders[key] as string | string[]);
        } catch { /* ignore */ }
      });
      expressRes.end(responseBuffer);
    });
  });

  // Error handler
  proxy.on('error', (err: Error, req: httpModule.IncomingMessage, res: httpModule.ServerResponse | import('net').Socket) => {
    console.error(`[RedirectProxy :${port}] Error:`, err.message);
    const expressReq = req as Request;
    const expressRes = res as Response;

    const startTime = expressReq._redirectStartTime || Date.now();
    const durationMs = Date.now() - startTime;
    const requestId = expressReq._redirectRequestId || uuidv4();
    const subscriber =
      expressReq._redirectSubscriber || resolveSubscriber(subscribers, req);

    logManager.saveLogEntry({
      id: requestId,
      appId: subscriber.app.id,
      appName: subscriber.app.name,
      backendName: subscriber.redirect.name,
      routeType: 'redirect',
      targetUrl,
      method: req.method || 'GET',
      endpoint: req.url || '/',
      requestHeaders: req.headers || {},
      requestBody: expressReq._redirectRawBodyStr || '',
      statusCode: 502,
      responseHeaders: { 'content-type': 'text/plain' },
      responseBody: `Redirect Proxy Error: ${err.message}`,
      durationMs,
      error: err.message
    });

    if (!expressRes.headersSent) {
      expressRes.status(502).json({ error: 'Redirect Proxy Error', details: err.message });
    }
  });

  // Express app for this port
  const expressApp = express();
  expressApp.use(cors());

  expressApp.use((req: Request, res: Response) => {
    const reqChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => reqChunks.push(chunk));
    req.on('end', () => {
      const rawReqBuffer = Buffer.concat(reqChunks);
      req._redirectRawBodyStr = extractBodyString(reqChunks);
      req._redirectRawBuffer = rawReqBuffer;
      req._redirectRequestId = uuidv4();
      req._redirectStartTime = Date.now();
      req._redirectSubscriber = resolveSubscriber(subscribers, req);

      const bufferStream = new PassThrough();
      bufferStream.end(rawReqBuffer);

      proxy.web(req, res, { buffer: bufferStream });
    });
  });

  const server = http.createServer(expressApp);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[RedirectProxy] Port ${port} already in use. Skipping.`);
      runningProxies.delete(port);
    } else {
      console.error(`[RedirectProxy :${port}] Server error:`, err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => { /* started */ });

  runningProxies.set(port, { server, proxy, port, targetUrl, subscribers });
}

/**
 * Stops the proxy server running on the specified port.
 */
export function stopRedirectProxy(port: number): void {
  const entry = runningProxies.get(port);
  if (!entry) return;
  entry.server.close(() => { /* closed */ });
  runningProxies.delete(port);
}

/**
 * Stops all running redirect proxy servers.
 */
export function stopAllRedirectProxies(): void {
  for (const port of Array.from(runningProxies.keys())) {
    stopRedirectProxy(port);
  }
}

/** Normalizes URL for comparison. */
function normalizeTargetUrl(url: string): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Reconciles running proxies against all active applications.
 * Groups by port, starts new servers, updates subscribers, and stops unused ports.
 */
export function syncRedirectProxies(allApps: Array<{
  isActive: boolean;
  id: string;
  name: string;
  frontEndUrl: string;
  backendUrls: Array<{ id: string; name: string; url: string; pathPrefix: string }>;
  redirectUrls: Array<{ id: string; name: string; targetUrl: string; port: number }>;
}>): void {
  // Group all active redirects by port
  const desiredByPort = new Map<number, { port: number; targetUrl: string; subscribers: RedirectSubscriber[] }>();

  for (const app of allApps) {
    if (!app.isActive) continue;
    for (const red of app.redirectUrls || []) {
      if (red.targetUrl && red.port) {
        if (!desiredByPort.has(red.port)) {
          desiredByPort.set(red.port, {
            port: red.port,
            targetUrl: red.targetUrl,
            subscribers: []
          });
        }
        desiredByPort.get(red.port)!.subscribers.push({ app, redirect: red });
      }
    }
  }

  // Stop proxies for ports no longer desired
  for (const [port] of runningProxies) {
    if (!desiredByPort.has(port)) {
      stopRedirectProxy(port);
    }
  }

  // Start or update proxies for desired ports
  for (const [port, desired] of desiredByPort) {
    const existing = runningProxies.get(port);
    if (!existing) {
      startRedirectProxy(port, desired.targetUrl, desired.subscribers);
    } else {
      if (normalizeTargetUrl(existing.targetUrl) !== normalizeTargetUrl(desired.targetUrl)) {
        startRedirectProxy(port, desired.targetUrl, desired.subscribers);
      } else {
        // Just update subscribers list in place
        existing.subscribers = desired.subscribers;
      }
    }
  }
}

/**
 * Returns all currently running redirect proxies (for the dashboard status API).
 */
export function getRunningRedirects(): RunningRedirectProxy[] {
  return Array.from(runningProxies.values()).map(entry => {
    const names = entry.subscribers.map(s => s.redirect.name).filter(Boolean);
    const appNames = entry.subscribers.map(s => s.app.name).filter(Boolean);
    const redirectIds = entry.subscribers.map(s => s.redirect.id);
    const appIds = entry.subscribers.map(s => s.app.id);

    return {
      id: redirectIds.join(','),
      name: names.length > 0 ? names.join(' / ') : 'API Redirection',
      port: entry.port,
      targetUrl: entry.targetUrl,
      appId: appIds.join(','),
      appName: appNames.length > 0 ? appNames.join(' / ') : 'Shared Application',
      localUrl: `http://localhost:${entry.port}`,
      subscribersCount: entry.subscribers.length
    };
  });
}
