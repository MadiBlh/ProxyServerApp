const fs = require('fs');
const path = require('path');
const os = require('os');
const settingsManager = require('./settingsManager');

function ensureDirectories() {
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  if (!fs.existsSync(headersDir)) {
    fs.mkdirSync(headersDir, { recursive: true });
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

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  const reqExt = getFileExtension(requestHeaders['content-type'], requestBody);
  const resExt = getFileExtension(responseHeaders ? responseHeaders['content-type'] : '', responseBody);

  const reqBodyPath = path.join(logsDir, `${id}_request.${reqExt}`);
  const resBodyPath = path.join(logsDir, `${id}_response.${resExt}`);

  const reqHeaderPath = path.join(headersDir, `${id}_request.json`);
  const resHeaderPath = path.join(headersDir, `${id}_response.json`);

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

function getAllLogs(appIdFilter = null, searchText = null, options = {}) {
  ensureDirectories();
  const headersDir = settingsManager.getHeadersDir();
  const logsDir = settingsManager.getLogsDir();

  if (!fs.existsSync(headersDir)) return [];

  const files = fs.readdirSync(headersDir);
  const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

  const endpointSearch = (options.endpoint || '').toLowerCase().trim();
  const bodySearch = (options.body || searchText || '').toLowerCase().trim();

  const logEntries = [];

  for (const file of reqHeaderFiles) {
    try {
      const uuid = file.replace('_request.json', '');
      const reqPath = path.join(headersDir, file);
      const resPath = path.join(headersDir, `${uuid}_response.json`);

      const reqMeta = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
      let resMeta = { statusCode: 500, statusText: 'FAILED', durationMs: 0, headers: {} };

      if (fs.existsSync(resPath)) {
        resMeta = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      }

      if (appIdFilter && reqMeta.appId !== appIdFilter) {
        continue;
      }

      const endpoint = reqMeta.endpoint || reqMeta.targetUrl || '';

      if (endpointSearch || bodySearch) {
        if (!matchesSearch(endpointSearch, bodySearch, reqMeta, resMeta, endpoint, logsDir, uuid)) {
          continue;
        }
      }

      logEntries.push({
        id: uuid,
        appId: reqMeta.appId,
        appName: reqMeta.appName,
        backendName: reqMeta.backendName || null,
        routeType: reqMeta.routeType || 'backend',
        timestamp: reqMeta.timestamp,
        method: reqMeta.method,
        endpoint,
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

function matchesSearch(endpointSearch, bodySearch, reqMeta, resMeta, endpoint, logsDir, uuid) {
  if (endpointSearch) {
    if (!(endpoint || '').toLowerCase().includes(endpointSearch)) {
      return false;
    }
  }

  if (bodySearch) {
    const reqBody = readBodyFile(logsDir, uuid, 'request', reqMeta.fileExtension);
    const resBody = readBodyFile(logsDir, uuid, 'response', resMeta.fileExtension);
    const bodyMatch = (reqBody && reqBody.toLowerCase().includes(bodySearch)) ||
                      (resBody && resBody.toLowerCase().includes(bodySearch));
    if (!bodyMatch) {
      return false;
    }
  }

  return true;
}

function readBodyFile(logsDir, uuid, kind, extension) {
  try {
    const bodyPath = path.join(logsDir, `${uuid}_${kind}.${extension || 'txt'}`);
    if (!fs.existsSync(bodyPath)) return null;
    return fs.readFileSync(bodyPath, 'utf8');
  } catch (err) {
    return null;
  }
}

function getLogDetail(id) {
  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  const reqHeaderPath = path.join(headersDir, `${id}_request.json`);
  const resHeaderPath = path.join(headersDir, `${id}_response.json`);

  if (!fs.existsSync(reqHeaderPath)) {
    return null;
  }

  const reqMeta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8'));
  const resMeta = fs.existsSync(resHeaderPath) ? JSON.parse(fs.readFileSync(resHeaderPath, 'utf8')) : {};

  // Read request body file
  const reqBodyPath = path.join(logsDir, `${id}_request.${reqMeta.fileExtension || 'txt'}`);
  let requestBody = '';
  if (fs.existsSync(reqBodyPath)) {
    requestBody = fs.readFileSync(reqBodyPath, 'utf8');
  }

  // Read response body file
  const resBodyPath = path.join(logsDir, `${id}_response.${resMeta.fileExtension || 'txt'}`);
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
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  if (fs.existsSync(logsDir)) {
    const logFiles = fs.readdirSync(logsDir);
    for (const f of logFiles) {
      const fullPath = path.join(logsDir, f);
      if (fs.statSync(fullPath).isFile()) fs.unlinkSync(fullPath);
    }
  }

  if (fs.existsSync(headersDir)) {
    const headerFiles = fs.readdirSync(headersDir);
    for (const f of headerFiles) {
      const fullPath = path.join(headersDir, f);
      if (fs.statSync(fullPath).isFile()) fs.unlinkSync(fullPath);
    }
  }

  return true;
}

function clearLogsForApp(appId) {
  if (!appId) return 0;

  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  let deleted = 0;

  for (const dir of [headersDir, logsDir]) {
    if (!fs.existsSync(dir)) continue;
    const fnames = fs.readdirSync(dir);
    for (const f of fnames) {
      let fullPath = path.join(dir, f);
      if (!fs.statSync(fullPath).isFile()) continue;
      if (f.endsWith('_request.json') || f.endsWith('_response.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (meta.appId === appId) {
            fs.unlinkSync(fullPath);
            deleted++;
          }
        } catch {
          // skip unparseable header
        }
      } else {
        // match body files by stripping the _request/_response suffix and comparing id
        const base = f.replace(/_(request|response)\..+$/, '');
        if (base === f) continue;
        const reqPath = path.join(headersDir, `${base}_request.json`);
        try {
          const meta = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
          if (meta.appId === appId) {
            fs.unlinkSync(fullPath);
            deleted++;
          }
        } catch {
          continue;
        }
      }
    }
  }

  return deleted;
}

function getDownloadsDir() {
  const dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function exportLog(id, customName) {
  const detail = getLogDetail(id);
  if (!detail) return null;

  ensureDirectories();

  const sanitizeName = customName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const downloadsDir = getDownloadsDir();

  const reqFileName = `${sanitizeName}_request.${detail.reqMeta.fileExtension || 'txt'}`;
  const resFileName = `${sanitizeName}_response.${detail.resMeta.fileExtension || 'txt'}`;

  const reqExportPath = path.join(downloadsDir, reqFileName);
  const resExportPath = path.join(downloadsDir, resFileName);

  fs.writeFileSync(reqExportPath, detail.requestBody || '', 'utf8');
  fs.writeFileSync(resExportPath, detail.responseBody || '', 'utf8');

  return {
    downloadPath: downloadsDir,
    requestFile: reqFileName,
    responseFile: resFileName
  };
}

module.exports = {
  saveLogEntry,
  getAllLogs,
  getLogDetail,
  clearAllLogs,
  clearLogsForApp,
  exportLog
};
