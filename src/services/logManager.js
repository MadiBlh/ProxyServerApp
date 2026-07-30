const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs');
const HEADERS_DIR = path.join(__dirname, '../../headers');

function ensureDirectories() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(HEADERS_DIR)) {
    fs.mkdirSync(HEADERS_DIR, { recursive: true });
  }
}

// Detect extension based on Content-Type or body content
function getFileExtension(contentType, bodyStr) {
  contentType = (contentType || '').toLowerCase();
  if (contentType.includes('json') || (bodyStr && bodyStr.trim().startsWith('{') || bodyStr && bodyStr.trim().startsWith('['))) {
    return 'json';
  }
  if (contentType.includes('xml') || (bodyStr && bodyStr.trim().startsWith('<'))) {
    return 'xml';
  }
  if (contentType.includes('html')) {
    return 'html';
  }
  if (contentType.includes('javascript') || contentType.includes('js')) {
    return 'js';
  }
  if (contentType.includes('css')) {
    return 'css';
  }
  return 'txt';
}

function saveLogEntry({ id, appId, appName, backendName, routeType, targetUrl, method, endpoint, requestHeaders, requestBody, statusCode, responseHeaders, responseBody, durationMs, error }) {
  ensureDirectories();

  const reqExt = getFileExtension(requestHeaders['content-type'], requestBody);
  const resExt = getFileExtension(responseHeaders ? responseHeaders['content-type'] : '', responseBody);

  const reqBodyPath = path.join(LOGS_DIR, `${id}_request.${reqExt}`);
  const resBodyPath = path.join(LOGS_DIR, `${id}_response.${resExt}`);

  const reqHeaderPath = path.join(HEADERS_DIR, `${id}_request.json`);
  const resHeaderPath = path.join(HEADERS_DIR, `${id}_response.json`);

  // Write body files
  fs.writeFileSync(reqBodyPath, requestBody || '', 'utf8');
  fs.writeFileSync(resBodyPath, responseBody || (error ? `Error: ${error}` : ''), 'utf8');

  const reqMeta = {
    id,
    appId,
    appName,
    backendName: backendName || null,
    routeType: routeType || 'backend',
    timestamp: new Date().toISOString(),
    method: method || 'GET',
    endpoint: endpoint || targetUrl || '/',
    targetUrl,
    contentType: requestHeaders['content-type'] || 'text/plain',
    fileExtension: reqExt,
    headers: requestHeaders
  };

  const statusOk = statusCode >= 200 && statusCode < 400 && !error;

  const resMeta = {
    id,
    appId,
    statusCode: statusCode || 500,
    statusText: statusOk ? 'OK' : 'FAILED',
    durationMs: durationMs || 0,
    contentType: responseHeaders ? (responseHeaders['content-type'] || 'text/plain') : 'text/plain',
    fileExtension: resExt,
    headers: responseHeaders || {},
    error: error || null
  };

  fs.writeFileSync(reqHeaderPath, JSON.stringify(reqMeta, null, 2), 'utf8');
  fs.writeFileSync(resHeaderPath, JSON.stringify(resMeta, null, 2), 'utf8');

  return { id, reqMeta, resMeta };
}

function getAllLogs(appIdFilter = null) {
  ensureDirectories();
  if (!fs.existsSync(HEADERS_DIR)) return [];

  const files = fs.readdirSync(HEADERS_DIR);
  const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

  const logEntries = [];

  for (const file of reqHeaderFiles) {
    try {
      const uuid = file.replace('_request.json', '');
      const reqPath = path.join(HEADERS_DIR, file);
      const resPath = path.join(HEADERS_DIR, `${uuid}_response.json`);

      const reqMeta = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
      let resMeta = { statusCode: 500, statusText: 'FAILED', durationMs: 0, headers: {} };

      if (fs.existsSync(resPath)) {
        resMeta = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      }

      if (appIdFilter && reqMeta.appId !== appIdFilter) {
        continue;
      }

      logEntries.push({
        id: uuid,
        appId: reqMeta.appId,
        appName: reqMeta.appName,
        backendName: reqMeta.backendName || null,
        routeType: reqMeta.routeType || 'backend',
        timestamp: reqMeta.timestamp,
        method: reqMeta.method,
        endpoint: reqMeta.endpoint,
        targetUrl: reqMeta.targetUrl,
        statusCode: resMeta.statusCode,
        status: resMeta.statusText || (resMeta.statusCode >= 200 && resMeta.statusCode < 400 ? 'OK' : 'FAILED'),
        durationMs: resMeta.durationMs,
        requestExt: reqMeta.fileExtension,
        responseExt: resMeta.fileExtension
      });
    } catch (err) {
      console.error(`Error reading log ${file}:`, err);
    }
  }

  // Sort by timestamp descending
  return logEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getLogDetail(id) {
  ensureDirectories();
  const reqHeaderPath = path.join(HEADERS_DIR, `${id}_request.json`);
  const resHeaderPath = path.join(HEADERS_DIR, `${id}_response.json`);

  if (!fs.existsSync(reqHeaderPath)) {
    return null;
  }

  const reqMeta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8'));
  const resMeta = fs.existsSync(resHeaderPath) ? JSON.parse(fs.readFileSync(resHeaderPath, 'utf8')) : {};

  // Read request body file
  const reqBodyPath = path.join(LOGS_DIR, `${id}_request.${reqMeta.fileExtension || 'txt'}`);
  let requestBody = '';
  if (fs.existsSync(reqBodyPath)) {
    requestBody = fs.readFileSync(reqBodyPath, 'utf8');
  }

  // Read response body file
  const resBodyPath = path.join(LOGS_DIR, `${id}_response.${resMeta.fileExtension || 'txt'}`);
  let responseBody = '';
  if (fs.existsSync(resBodyPath)) {
    responseBody = fs.readFileSync(resBodyPath, 'utf8');
  }

  return {
    id,
    reqMeta,
    resMeta,
    requestBody,
    responseBody
  };
}

function clearAllLogs() {
  ensureDirectories();
  const logFiles = fs.readdirSync(LOGS_DIR);
  for (const f of logFiles) {
    fs.unlinkSync(path.join(LOGS_DIR, f));
  }
  const headerFiles = fs.readdirSync(HEADERS_DIR);
  for (const f of headerFiles) {
    fs.unlinkSync(path.join(HEADERS_DIR, f));
  }
  return true;
}

function exportLog(id, customName) {
  const detail = getLogDetail(id);
  if (!detail) return null;

  ensureDirectories();

  const sanitizeName = customName.replace(/[^a-zA-Z0-9_-]/g, '_');

  const reqExportPath = path.join(LOGS_DIR, `${sanitizeName}_request.${detail.reqMeta.fileExtension || 'txt'}`);
  const resExportPath = path.join(LOGS_DIR, `${sanitizeName}_response.${detail.resMeta.fileExtension || 'txt'}`);

  fs.writeFileSync(reqExportPath, detail.requestBody, 'utf8');
  fs.writeFileSync(resExportPath, detail.responseBody, 'utf8');

  return {
    requestFile: `${sanitizeName}_request.${detail.reqMeta.fileExtension || 'txt'}`,
    responseFile: `${sanitizeName}_response.${detail.resMeta.fileExtension || 'txt'}`
  };
}

module.exports = {
  saveLogEntry,
  getAllLogs,
  getLogDetail,
  clearAllLogs,
  exportLog
};
