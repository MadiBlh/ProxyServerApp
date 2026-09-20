import fs from 'fs';
import path from 'path';
import os from 'os';
import * as settingsManager from './settingsManager';
import type {
  SaveLogEntryParams,
  SaveLogEntryResult,
  ReqMeta,
  ResMeta,
  LogEntry,
  LogDetail,
  LogSearchOptions,
  ArchiveResult,
  ExportResult
} from '../types';

function ensureDirectories(): void {
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  if (!fs.existsSync(headersDir)) {
    fs.mkdirSync(headersDir, { recursive: true });
  }
}

/** Detect file extension based on Content-Type or body content. */
function getFileExtension(contentType: string | undefined, bodyStr: string | undefined): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('json') || (bodyStr && (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')))) {
    return 'json';
  }
  if (ct.includes('xml') || (bodyStr && bodyStr.trim().startsWith('<'))) {
    return 'xml';
  }
  if (ct.includes('html')) return 'html';
  if (ct.includes('javascript') || ct.includes('js')) return 'js';
  if (ct.includes('css')) return 'css';
  return 'txt';
}

export function saveLogEntry({
  id,
  appId,
  appName,
  backendName,
  routeType,
  targetUrl,
  method,
  endpoint,
  requestHeaders,
  requestBody,
  statusCode,
  responseHeaders,
  responseBody,
  durationMs,
  error
}: SaveLogEntryParams): SaveLogEntryResult {
  ensureDirectories();

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  const contentTypeReq = requestHeaders['content-type'];
  const contentTypeRes = responseHeaders ? responseHeaders['content-type'] : undefined;

  const reqExt = getFileExtension(
    Array.isArray(contentTypeReq) ? contentTypeReq[0] : contentTypeReq,
    requestBody
  );
  const resExt = getFileExtension(
    Array.isArray(contentTypeRes) ? contentTypeRes[0] : contentTypeRes,
    responseBody
  );

  const reqBodyPath = path.join(logsDir, `${id}_request.${reqExt}`);
  const resBodyPath = path.join(logsDir, `${id}_response.${resExt}`);
  const reqHeaderPath = path.join(headersDir, `${id}_request.json`);
  const resHeaderPath = path.join(headersDir, `${id}_response.json`);

  // Write body files
  fs.writeFileSync(reqBodyPath, requestBody || '', 'utf8');
  fs.writeFileSync(resBodyPath, responseBody || (error ? `Error: ${error}` : ''), 'utf8');

  const contentTypeReqStr = Array.isArray(contentTypeReq)
    ? (contentTypeReq[0] ?? 'text/plain')
    : (contentTypeReq ?? 'text/plain');

  const reqMeta: ReqMeta = {
    id,
    appId,
    appName,
    backendName: backendName || null,
    routeType: (routeType as 'backend' | 'redirect') || 'backend',
    timestamp: new Date().toISOString(),
    method: method || 'GET',
    endpoint: endpoint || targetUrl || '/',
    targetUrl,
    contentType: contentTypeReqStr,
    fileExtension: reqExt,
    headers: requestHeaders
  };

  const finalStatusCode = statusCode ?? 500;
  const statusOk = finalStatusCode >= 200 && finalStatusCode < 400 && !error;

  const contentTypeResStr = responseHeaders
    ? (Array.isArray(responseHeaders['content-type'])
        ? (responseHeaders['content-type'][0] ?? 'text/plain')
        : (responseHeaders['content-type'] ?? 'text/plain'))
    : 'text/plain';

  const resMeta: ResMeta = {
    id,
    appId,
    statusCode: finalStatusCode,
    statusText: statusOk ? 'OK' : 'FAILED',
    durationMs: durationMs || 0,
    contentType: contentTypeResStr,
    fileExtension: resExt,
    headers: responseHeaders || {},
    error: error || null
  };

  fs.writeFileSync(reqHeaderPath, JSON.stringify(reqMeta, null, 2), 'utf8');
  fs.writeFileSync(resHeaderPath, JSON.stringify(resMeta, null, 2), 'utf8');

  return { id, reqMeta, resMeta };
}

export function getAllLogs(
  appIdFilter: string | null = null,
  searchText: string | null = null,
  options: LogSearchOptions = {}
): LogEntry[] {
  ensureDirectories();
  const headersDir = settingsManager.getHeadersDir();
  const logsDir = settingsManager.getLogsDir();

  if (!fs.existsSync(headersDir)) return [];

  const files = fs.readdirSync(headersDir);
  const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

  const endpointSearch = (options.endpoint || '').toLowerCase().trim();
  const bodySearch = (options.body || searchText || '').toLowerCase().trim();

  const logEntries: LogEntry[] = [];

  for (const file of reqHeaderFiles) {
    try {
      const uuid = file.replace('_request.json', '');
      const reqPath = path.join(headersDir, file);
      const resPath = path.join(headersDir, `${uuid}_response.json`);

      const reqMeta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as ReqMeta;
      let resMeta: Partial<ResMeta> = { statusCode: 500, statusText: 'FAILED', durationMs: 0, headers: {} };

      if (fs.existsSync(resPath)) {
        resMeta = JSON.parse(fs.readFileSync(resPath, 'utf8')) as ResMeta;
      }

      if (appIdFilter && reqMeta.appId !== appIdFilter) {
        continue;
      }

      const endpoint = reqMeta.endpoint || reqMeta.targetUrl || '';

      if (endpointSearch || bodySearch) {
        if (!matchesSearch(endpointSearch, bodySearch, reqMeta, resMeta as ResMeta, endpoint, logsDir, uuid)) {
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
        statusCode: resMeta.statusCode ?? 500,
        status:
          resMeta.statusText ||
          ((resMeta.statusCode ?? 500) >= 200 && (resMeta.statusCode ?? 500) < 400 ? 'OK' : 'FAILED'),
        durationMs: resMeta.durationMs ?? 0,
        requestExt: reqMeta.fileExtension,
        responseExt: resMeta.fileExtension ?? 'txt'
      });
    } catch (err) {
      console.error(`Error reading log ${file}:`, err);
    }
  }

  // Sort by timestamp descending
  return logEntries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function matchesSearch(
  endpointSearch: string,
  bodySearch: string,
  reqMeta: ReqMeta,
  resMeta: ResMeta,
  endpoint: string,
  logsDir: string,
  uuid: string
): boolean {
  if (endpointSearch) {
    if (!(endpoint || '').toLowerCase().includes(endpointSearch)) {
      return false;
    }
  }
  if (bodySearch) {
    const reqBody = readBodyFile(logsDir, uuid, 'request', reqMeta.fileExtension);
    const resBody = readBodyFile(logsDir, uuid, 'response', resMeta.fileExtension);
    const bodyMatch =
      (reqBody && reqBody.toLowerCase().includes(bodySearch)) ||
      (resBody && resBody.toLowerCase().includes(bodySearch));
    if (!bodyMatch) {
      return false;
    }
  }
  return true;
}

function readBodyFile(
  logsDir: string,
  uuid: string,
  kind: 'request' | 'response',
  extension: string | undefined
): string | null {
  try {
    const bodyPath = path.join(logsDir, `${uuid}_${kind}.${extension || 'txt'}`);
    if (!fs.existsSync(bodyPath)) return null;
    return fs.readFileSync(bodyPath, 'utf8');
  } catch {
    return null;
  }
}

export function getLogDetail(id: string): LogDetail | null {
  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  const reqHeaderPath = path.join(headersDir, `${id}_request.json`);
  const resHeaderPath = path.join(headersDir, `${id}_response.json`);

  if (!fs.existsSync(reqHeaderPath)) {
    return null;
  }

  const reqMeta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8')) as ReqMeta;
  const resMeta: ResMeta = fs.existsSync(resHeaderPath)
    ? (JSON.parse(fs.readFileSync(resHeaderPath, 'utf8')) as ResMeta)
    : ({} as ResMeta);

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

  return { id, reqMeta, resMeta, requestBody, responseBody };
}

export function clearAllLogs(): boolean {
  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  if (fs.existsSync(logsDir)) {
    for (const f of fs.readdirSync(logsDir)) {
      const fullPath = path.join(logsDir, f);
      if (fs.statSync(fullPath).isFile()) fs.unlinkSync(fullPath);
    }
  }
  if (fs.existsSync(headersDir)) {
    for (const f of fs.readdirSync(headersDir)) {
      const fullPath = path.join(headersDir, f);
      if (fs.statSync(fullPath).isFile()) fs.unlinkSync(fullPath);
    }
  }
  return true;
}

export function clearLogsForApp(appId: string): number {
  if (!appId) return 0;
  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  let deleted = 0;

  for (const dir of [headersDir, logsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (!fs.statSync(fullPath).isFile()) continue;

      if (f.endsWith('_request.json') || f.endsWith('_response.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as { appId: string };
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
          const meta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as { appId: string };
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

export function archiveLogsForApp(appId: string, appName?: string): ArchiveResult {
  if (!appId) return { archived: 0 };
  ensureDirectories();

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  const archivesDir = settingsManager.getArchivesDir();

  // Create archive subdirectories
  const sanitizeName =
    (appName || 'unknown').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'unknown';
  const archiveLogsDir = path.join(archivesDir, sanitizeName, 'logs');
  const archiveHeadersDir = path.join(archivesDir, sanitizeName, 'headers');

  if (!fs.existsSync(archiveLogsDir)) fs.mkdirSync(archiveLogsDir, { recursive: true });
  if (!fs.existsSync(archiveHeadersDir)) fs.mkdirSync(archiveHeadersDir, { recursive: true });

  let archived = 0;
  const filesToMove: Array<{ src: string; dest: string }> = [];

  // First pass: identify all files belonging to this appId
  for (const dir of [headersDir, logsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (!fs.statSync(fullPath).isFile()) continue;

      let belongsToApp = false;

      if (f.endsWith('_request.json') || f.endsWith('_response.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as { appId: string };
          if (meta.appId === appId) belongsToApp = true;
        } catch {
          // skip unparseable header
        }
      } else {
        const base = f.replace(/_(request|response)\..+$/, '');
        if (base === f) continue;
        const reqPath = path.join(headersDir, `${base}_request.json`);
        try {
          const meta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as { appId: string };
          if (meta.appId === appId) belongsToApp = true;
        } catch {
          continue;
        }
      }

      if (belongsToApp) {
        const targetDir = dir === logsDir ? archiveLogsDir : archiveHeadersDir;
        filesToMove.push({ src: fullPath, dest: path.join(targetDir, f) });
      }
    }
  }

  // Second pass: move files (using rename for atomicity where possible)
  for (const { src, dest } of filesToMove) {
    try {
      fs.renameSync(src, dest);
      archived++;
    } catch {
      // If rename fails across devices, fall back to copy + delete
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        archived++;
      } catch (copyErr) {
        console.error(`Failed to archive ${src}:`, (copyErr as Error).message);
      }
    }
  }

  return { archived, archivePath: path.join(archivesDir, sanitizeName) };
}

export function deleteLogsByIds(ids: string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  ensureDirectories();

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  const idSet = new Set(ids);
  let deleted = 0;

  for (const dir of [headersDir, logsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (!fs.statSync(fullPath).isFile()) continue;

      let baseId: string | null = null;
      if (f.endsWith('_request.json') || f.endsWith('_response.json')) {
        baseId = f.replace(/_(request|response)\.json$/, '');
      } else {
        const m = f.match(/^(.*?)_(request|response)\..+$/);
        if (m) baseId = m[1] ?? null;
      }

      if (baseId && idSet.has(baseId)) {
        try {
          fs.unlinkSync(fullPath);
          deleted++;
        } catch (err) {
          console.error(`Failed to delete ${fullPath}:`, (err as Error).message);
        }
      }
    }
  }
  return deleted;
}

function getDownloadsDir(): string {
  const dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function exportLog(id: string, customName: string): ExportResult | null {
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
