require('../utils/bootstrap');

const httpProxy = require('http-proxy');
const { v4: uuidv4 } = require('uuid');
const configManager = require('./configManager');
const logManager = require('./logManager');

// Create http-proxy instance with selfHandleResponse set to true
const proxy = httpProxy.createProxyServer({
  selfHandleResponse: true,
  changeOrigin: true,
  secure: false
});

// Real-time clients array for SSE updates
const sseClients = [];

function registerSseClient(res) {
  sseClients.push(res);
}

function unregisterSseClient(res) {
  const idx = sseClients.indexOf(res);
  if (idx !== -1) sseClients.splice(idx, 1);
}

function broadcastLogEvent(logSummary) {
  const data = `data: ${JSON.stringify(logSummary)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(data);
    } catch (e) {
      // client disconnected
    }
  });
}

// Handle response interception
proxy.on('proxyRes', (proxyRes, req, res) => {
  const startTime = req._proxyStartTime || Date.now();
  const durationMs = Date.now() - startTime;
  const requestId = req._proxyRequestId;
  const app = req._proxyApp;
  const targetUrl = req._proxyTargetUrl;

  const responseHeaders = proxyRes.headers;
  const statusCode = proxyRes.statusCode;

  const bodyChunks = [];

  proxyRes.on('data', (chunk) => {
    bodyChunks.push(chunk);
  });

  proxyRes.on('end', () => {
    const responseBuffer = Buffer.concat(bodyChunks);
    const responseBodyStr = responseBuffer.toString('utf8');

    // Save log entry to files (logs/ & headers/)
    const { reqMeta, resMeta } = logManager.saveLogEntry({
      id: requestId,
      appId: app.id,
      appName: app.name,
      backendName: req._proxyBackendService ? req._proxyBackendService.name : null,
      routeType: req._proxyBackendService ? req._proxyBackendService.routeType : 'backend',
      targetUrl,
      method: req.method,
      endpoint: req.url,
      requestHeaders: req.headers,
      requestBody: req._proxyRawBodyStr || '',
      statusCode: statusCode,
      responseHeaders: responseHeaders,
      responseBody: responseBodyStr,
      durationMs: durationMs
    });

    // Broadcast SSE log event to frontend
    broadcastLogEvent({
      id: requestId,
      appId: app.id,
      appName: app.name,
      backendName: req._proxyBackendService ? req._proxyBackendService.name : undefined,
      routeType: req._proxyBackendService ? req._proxyBackendService.routeType : 'backend',
      timestamp: reqMeta.timestamp,
      method: req.method,
      endpoint: req.url,
      statusCode: statusCode,
      status: resMeta.statusText,
      durationMs: durationMs
    });

    // Forward original target headers and status to client
    res.status(statusCode);
    Object.keys(responseHeaders).forEach(key => {
      res.setHeader(key, responseHeaders[key]);
    });
    res.end(responseBuffer);
  });
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  const startTime = req._proxyStartTime || Date.now();
  const durationMs = Date.now() - startTime;
  const requestId = req._proxyRequestId || uuidv4();
  const app = req._proxyApp || { id: 'unknown', name: 'Unknown' };

  logManager.saveLogEntry({
    id: requestId,
    appId: app.id,
    appName: app.name,
    targetUrl: req._proxyTargetUrl || req.url,
    method: req.method,
    endpoint: req.url,
    requestHeaders: req.headers || {},
    requestBody: req._proxyRawBodyStr || '',
    statusCode: 502,
    responseHeaders: { 'content-type': 'text/plain' },
    responseBody: `Proxy Connection Error: ${err.message}`,
    durationMs: durationMs,
    error: err.message
  });

  if (!res.headersSent) {
    res.status(502).json({
      error: 'Proxy Target Connection Failed',
      details: err.message
    });
  }
});

// Middleware for intercepting proxy requests
function proxyMiddleware(req, res, next) {
  // Capture raw request body first
  const reqChunks = [];

  req.on('data', (chunk) => {
    reqChunks.push(chunk);
  });

  req.on('end', () => {
    const rawReqBuffer = Buffer.concat(reqChunks);
    req._proxyRawBodyStr = rawReqBuffer.toString('utf8');
    req._proxyRawBuffer = rawReqBuffer;

    // 1. Determine request path
    let requestPath = req.originalUrl || req.url;

    // If using explicit /proxy/:appId route, strip prefix
    if (req.params && req.params.appId) {
      const routePrefix = `/proxy/${req.params.appId}`;
      if (requestPath.startsWith(routePrefix)) {
        requestPath = requestPath.substring(routePrefix.length) || '/';
      }
    }
    req.url = requestPath;

    let apps = configManager.getApplications();
    const activeApps = apps.filter(a => a.isActive);

    if (activeApps.length === 0) {
      return res.status(404).json({
        error: 'No active web applications configured. Please create an application in the dashboard.'
      });
    }

    let targetApp = null;
    let selectedBackend = null;

    // Check if explicit appId header/param/query is provided
    const explicitAppId = (req.params && req.params.appId) || req.headers['x-proxy-app-id'] || req.headers['x-app-id'] || (req.query && req.query._appId);

    if (explicitAppId) {
      targetApp = activeApps.find(a => a.id === explicitAppId);
      if (targetApp) {
        const routes = [
          ...(targetApp.backendUrls || []).map(b => ({ ...b, url: b.url, routeType: 'backend' })),
          ...(targetApp.redirectUrls || []).map(r => ({ ...r, url: r.targetUrl, routeType: 'redirect' }))
        ].sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);
        selectedBackend = routes.find(be => (be.pathPrefix || '').trim() && requestPath.startsWith(be.pathPrefix.trim())) || routes[0];
      }
    }

    // If no explicit app ID, search ALL active backend and redirect routes across ALL active apps by pathPrefix
    if (!selectedBackend) {
      const allActiveRoutes = [];
      for (const app of activeApps) {
        if (app.backendUrls) {
          app.backendUrls.forEach(be => {
            if (be.url && be.pathPrefix) {
              allActiveRoutes.push({ ...be, url: be.url, routeType: 'backend', app });
            }
          });
        }
        if (app.redirectUrls) {
          app.redirectUrls.forEach(red => {
            if (red.targetUrl && red.pathPrefix) {
              allActiveRoutes.push({ ...red, url: red.targetUrl, routeType: 'redirect', app });
            }
          });
        }
      }

      // Sort all active routes by pathPrefix length descending (longest/most specific prefix first)
      allActiveRoutes.sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);

      // Find matching backend/redirect service by pathPrefix
      const match = allActiveRoutes.find(be => requestPath.startsWith(be.pathPrefix.trim()));
      if (match) {
        selectedBackend = match;
        targetApp = match.app;
      }
    }

    // Fallback: If pathPrefix still didn't match (e.g. request to root '/'), try matching Referer/Origin or use first active backend
    if (!selectedBackend) {
      const referer = (req.headers['referer'] || req.headers['origin'] || '').toLowerCase();
      if (referer) {
        const appMatch = activeApps.find(app => {
          if (!app.frontEndUrl) return false;
          const cleanFront = app.frontEndUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
          return referer.includes(cleanFront);
        });
        if (appMatch && appMatch.backendUrls && appMatch.backendUrls.length > 0) {
          targetApp = appMatch;
          selectedBackend = appMatch.backendUrls[0];
        }
      }
    }

    if (!selectedBackend || !targetApp) {
      const configuredPrefixes = activeApps.flatMap(a => (a.backendUrls || []).map(b => `'${b.pathPrefix}' (${a.name} → ${b.url})`)).join(', ');
      return res.status(404).json({
        error: `No backend service matched path '${requestPath}'. Please check pathPrefix configuration in the dashboard.`,
        configuredPrefixes: configuredPrefixes || 'None'
      });
    }

    const targetBackendUrl = selectedBackend.url;

    req._proxyRequestId = uuidv4();
    req._proxyStartTime = Date.now();
    req._proxyApp = targetApp;
    req._proxyBackendService = selectedBackend;
    req._proxyTargetUrl = targetBackendUrl;

    // Re-stream buffered body for http-proxy
    const Stream = require('stream');
    const bufferStream = new Stream.PassThrough();
    bufferStream.end(rawReqBuffer);

    proxy.web(req, res, {
      target: targetBackendUrl,
      buffer: bufferStream
    });
  });
}

module.exports = {
  proxyMiddleware,
  registerSseClient,
  unregisterSseClient
};
