require('../utils/bootstrap');

const http = require('http');
const express = require('express');
const cors = require('cors');
const httpProxy = require('http-proxy');
const uuidv4 = require('../utils/uuid');
const logManager = require('./logManager');

/* ==========================================================================
   REDIRECT PROXY MANAGER
   Manages dedicated HTTP proxy servers per configured redirect port.
   If multiple web applications define the same external target URL,
   they share the same proxy server port seamlessly without port collision.
   ========================================================================== */

// Map of port (number) -> { server, proxy, port, targetUrl, subscribers: [ { app, redirect } ] }
const runningProxies = new Map();

// SSE clients shared with the main proxy engine for the unified log feed
let sseClients = [];

function setSseClients(clients) {
  sseClients = clients;
}

function broadcastLogEvent(logSummary) {
  const data = `data: ${JSON.stringify(logSummary)}\n\n`;
  sseClients.forEach(client => {
    try { client.write(data); } catch (e) { /* client disconnected */ }
  });
}

/**
 * Resolves the most relevant subscriber app for an incoming request on a shared redirect port.
 */
function resolveSubscriber(subscribers, req) {
  if (!subscribers || subscribers.length === 0) {
    return {
      app: { id: 'shared', name: 'Shared API Redirect' },
      redirect: { id: 'shared', name: 'External API' }
    };
  }

  // 1. Check explicit header
  const explicitAppId = req.headers['x-proxy-app-id'] || req.headers['x-app-id'];
  if (explicitAppId) {
    const match = subscribers.find(s => s.app.id === explicitAppId);
    if (match) return match;
  }

  // 2. Check Referer or Origin header against frontend URLs
  const referer = (req.headers['referer'] || req.headers['origin'] || '').toLowerCase();
  if (referer) {
    const match = subscribers.find(s => {
      if (!s.app.frontEndUrl) return false;
      const cleanFront = s.app.frontEndUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      return referer.includes(cleanFront);
    });
    if (match) return match;
  }

  // 3. Fallback: First subscriber
  return subscribers[0];
}

/**
 * Starts a dedicated proxy server on a specific port for a target URL.
 * @param {number} port
 * @param {string} targetUrl
 * @param {Array<{ app: object, redirect: object }>} subscribers
 */
function startRedirectProxy(port, targetUrl, subscribers) {
  if (runningProxies.has(port)) {
    stopRedirectProxy(port);
  }

  if (!targetUrl || !port) {
    console.warn(`[RedirectProxy] Skipping start on port ${port} — missing targetUrl or port`);
    return;
  }

  const primaryName = subscribers.map(s => s.redirect.name).filter(Boolean).join(' / ') || 'API Redirection';

  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
    cookieDomainRewrite: { '*': '' }
  });

  // Response handler: buffer, log, forward
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const startTime = req._redirectStartTime || Date.now();
    const durationMs = Date.now() - startTime;
    const requestId = req._redirectRequestId;
    const subscriber = req._redirectSubscriber || resolveSubscriber(subscribers, req);
    const responseHeaders = proxyRes.headers;
    const statusCode = proxyRes.statusCode;

    const bodyChunks = [];
    proxyRes.on('data', chunk => bodyChunks.push(chunk));
    proxyRes.on('end', () => {
      const responseBuffer = Buffer.concat(bodyChunks);
      const responseBodyStr = responseBuffer.toString('utf8');

      const { reqMeta, resMeta } = logManager.saveLogEntry({
        id: requestId,
        appId: subscriber.app.id,
        appName: subscriber.app.name,
        backendName: subscriber.redirect.name,
        routeType: 'redirect',
        targetUrl,
        method: req.method,
        endpoint: req.url,
        requestHeaders: req.headers,
        requestBody: req._redirectRawBodyStr || '',
        statusCode,
        responseHeaders,
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

      res.status(statusCode);
      Object.keys(responseHeaders).forEach(key => {
        const lk = key.toLowerCase();
        if (lk === 'content-length' || lk === 'transfer-encoding') return;
        try { res.setHeader(key, responseHeaders[key]); } catch (_) {}
      });
      res.end(responseBuffer);
    });
  });

  // Error handler
  proxy.on('error', (err, req, res) => {
    console.error(`[RedirectProxy :${port}] Error:`, err.message);
    const startTime = req._redirectStartTime || Date.now();
    const durationMs = Date.now() - startTime;
    const requestId = req._redirectRequestId || uuidv4();
    const subscriber = req._redirectSubscriber || resolveSubscriber(subscribers, req);

    logManager.saveLogEntry({
      id: requestId,
      appId: subscriber.app.id,
      appName: subscriber.app.name,
      backendName: subscriber.redirect.name,
      routeType: 'redirect',
      targetUrl,
      method: req.method,
      endpoint: req.url,
      requestHeaders: req.headers || {},
      requestBody: req._redirectRawBodyStr || '',
      statusCode: 502,
      responseHeaders: { 'content-type': 'text/plain' },
      responseBody: `Redirect Proxy Error: ${err.message}`,
      durationMs,
      error: err.message
    });

    if (!res.headersSent) {
      res.status(502).json({ error: 'Redirect Proxy Error', details: err.message });
    }
  });

  // Express app for this port
  const expressApp = express();
  expressApp.use(cors());

  expressApp.use((req, res) => {
    const reqChunks = [];
    req.on('data', chunk => reqChunks.push(chunk));
    req.on('end', () => {
      const rawReqBuffer = Buffer.concat(reqChunks);
      req._redirectRawBodyStr = rawReqBuffer.toString('utf8');
      req._redirectRawBuffer = rawReqBuffer;
      req._redirectRequestId = uuidv4();
      req._redirectStartTime = Date.now();
      req._redirectSubscriber = resolveSubscriber(subscribers, req);

      const Stream = require('stream');
      const bufferStream = new Stream.PassThrough();
      bufferStream.end(rawReqBuffer);

      proxy.web(req, res, { buffer: bufferStream });
    });
  });

  const server = http.createServer(expressApp);

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[RedirectProxy] Port ${port} already in use. Skipping.`);
    } else {
      console.error(`[RedirectProxy :${port}] Server error:`, err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`  Redirect proxy  "${primaryName}"  :${port}  ->  ${targetUrl}`);
  });

  runningProxies.set(port, { server, proxy, port, targetUrl, subscribers });
}

/**
 * Stops the proxy server running on the specified port.
 * @param {number} port
 */
function stopRedirectProxy(port) {
  const entry = runningProxies.get(port);
  if (!entry) return;
  const name = entry.subscribers.map(s => s.redirect.name).join(' / ') || 'Redirect Proxy';
  entry.server.close(() => {
    console.log(`  Redirect proxy stopped  "${name}"  :${entry.port}`);
  });
  runningProxies.delete(port);
}

/**
 * Normalizes URL for comparison.
 */
function normalizeTargetUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Reconciles running proxies against all active applications.
 * Groups by port, starts new servers, updates subscribers, and stops unused ports.
 * @param {Array} allApps
 */
function syncRedirectProxies(allApps) {
  // Group all active redirects by port
  const desiredByPort = new Map(); // port -> { port, targetUrl, subscribers: [] }

  for (const app of allApps) {
    if (!app.isActive) continue;
    for (const red of (app.redirectUrls || [])) {
      if (red.targetUrl && red.port) {
        if (!desiredByPort.has(red.port)) {
          desiredByPort.set(red.port, {
            port: red.port,
            targetUrl: red.targetUrl,
            subscribers: []
          });
        }
        desiredByPort.get(red.port).subscribers.push({ app, redirect: red });
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
      // If targetUrl changed on the same port, restart
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
function getRunningRedirects() {
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

module.exports = {
  syncRedirectProxies,
  stopRedirectProxy,
  getRunningRedirects,
  setSseClients
};
