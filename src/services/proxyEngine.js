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

    // Identify target web app
    let appId = req.params.appId || req.headers['x-proxy-app-id'] || req.query._appId;
    let apps = configManager.getApplications();

    let targetApp = null;

    if (appId) {
      targetApp = apps.find(a => a.id === appId && a.isActive);
    }

    if (!targetApp) {
      // If no explicit appId parameter, check active apps host or fallback to first active app
      const activeApps = apps.filter(a => a.isActive);
      if (activeApps.length > 0) {
        targetApp = activeApps[0];
      }
    }

    if (!targetApp || !targetApp.backendUrls || targetApp.backendUrls.length === 0) {
      return res.status(404).json({
        error: 'No active web application or backend service configured'
      });
    }

    // Determine target backend url
    const backendService = targetApp.backendUrls[0];
    const targetBackendUrl = backendService.url;

    req._proxyRequestId = uuidv4();
    req._proxyStartTime = Date.now();
    req._proxyApp = targetApp;
    req._proxyTargetUrl = targetBackendUrl;

    // Remove proxy route prefix from target request URL if using /proxy/:appId/...
    let originalPath = req.originalUrl || req.url;
    if (req.params.appId) {
      const prefix = `/proxy/${req.params.appId}`;
      if (originalPath.startsWith(prefix)) {
        req.url = originalPath.substring(prefix.length) || '/';
      }
    }

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
