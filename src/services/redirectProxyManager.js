require('../utils/bootstrap');

const http = require('http');
const express = require('express');
const cors = require('cors');
const httpProxy = require('http-proxy');
const uuidv4 = require('../utils/uuid');
const logManager = require('./logManager');

/* ==========================================================================
   REDIRECT PROXY MANAGER
   Manages one dedicated HTTP proxy server per configured redirectUrl.
   Each server listens on its own port and forwards ALL traffic (any path)
   to a single target URL — no path-prefix matching needed.
   ========================================================================== */

// Map of redirectId -> { server, port, targetUrl, name, appId, appName }
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
 * Starts a dedicated proxy server for a single redirect URL entry.
 */
function startRedirectProxy(redirect, app) {
  if (runningProxies.has(redirect.id)) {
    stopRedirectProxy(redirect.id); // restart with fresh config
  }

  const { id, name, targetUrl, port } = redirect;

  if (!targetUrl || !port) {
    console.warn(`[RedirectProxy] Skipping "${name}" — missing targetUrl or port`);
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
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const startTime = req._redirectStartTime || Date.now();
    const durationMs = Date.now() - startTime;
    const requestId = req._redirectRequestId;
    const responseHeaders = proxyRes.headers;
    const statusCode = proxyRes.statusCode;

    const bodyChunks = [];
    proxyRes.on('data', chunk => bodyChunks.push(chunk));
    proxyRes.on('end', () => {
      const responseBuffer = Buffer.concat(bodyChunks);
      const responseBodyStr = responseBuffer.toString('utf8');

      const { reqMeta, resMeta } = logManager.saveLogEntry({
        id: requestId,
        appId: app.id,
        appName: app.name,
        backendName: name,
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
        appId: app.id,
        appName: app.name,
        backendName: name,
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

    logManager.saveLogEntry({
      id: requestId,
      appId: app.id,
      appName: app.name,
      backendName: name,
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

      const Stream = require('stream');
      const bufferStream = new Stream.PassThrough();
      bufferStream.end(rawReqBuffer);

      proxy.web(req, res, { buffer: bufferStream });
    });
  });

  const server = http.createServer(expressApp);

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[RedirectProxy] Port ${port} already in use for "${name}". Skipping.`);
    } else {
      console.error(`[RedirectProxy :${port}] Server error:`, err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`  Redirect proxy  "${name}"  :${port}  ->  ${targetUrl}`);
  });

  runningProxies.set(id, { server, port, targetUrl, name, appId: app.id, appName: app.name });
}

/**
 * Stops the proxy server for the given redirectId.
 */
function stopRedirectProxy(redirectId) {
  const entry = runningProxies.get(redirectId);
  if (!entry) return;
  entry.server.close(() => {
    console.log(`  Redirect proxy stopped  "${entry.name}"  :${entry.port}`);
  });
  runningProxies.delete(redirectId);
}

/**
 * Reconciles running proxies against the current app config.
 * Starts new ones, stops removed ones. Call after any CRUD operation.
 */
function syncRedirectProxies(allApps) {
  const desired = new Map();
  for (const app of allApps) {
    if (!app.isActive) continue;
    for (const red of (app.redirectUrls || [])) {
      if (red.targetUrl && red.port) {
        desired.set(red.id, { redirect: red, app });
      }
    }
  }

  // Stop proxies that are no longer in config
  for (const [id] of runningProxies) {
    if (!desired.has(id)) stopRedirectProxy(id);
  }

  // Start proxies that are new or changed
  for (const [id, { redirect, app }] of desired) {
    const existing = runningProxies.get(id);
    const changed = !existing ||
      existing.port !== redirect.port ||
      existing.targetUrl !== redirect.targetUrl;
    if (changed) startRedirectProxy(redirect, app);
  }
}

/**
 * Returns all currently running redirect proxies (for the dashboard status API).
 */
function getRunningRedirects() {
  return Array.from(runningProxies.entries()).map(([id, entry]) => ({
    id,
    name: entry.name,
    port: entry.port,
    targetUrl: entry.targetUrl,
    appId: entry.appId,
    appName: entry.appName,
    localUrl: `http://localhost:${entry.port}`
  }));
}

module.exports = {
  syncRedirectProxies,
  stopRedirectProxy,
  getRunningRedirects,
  setSseClients
};
