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
  ArchiveOptions,
  ArchiveManifest,
  ArchivedAppSummary,
  RestoreResult,
  ArchiveResult,
  ExportResult
} from '../types';

// In-memory cache for initialized directories to avoid redundant fs.existsSync / mkdirSync syscalls
const initializedDirs = new Set<string>();

/**
 * Clears the in-memory directory existence cache.
 */
export function clearDirectoryCache(): void {
  initializedDirs.clear();
}

/**
 * Ensures that a directory exists, caching the result to eliminate redundant fs syscalls.
 */
export function ensurePathExists(dirPath: string): void {
  const normalized = path.normalize(dirPath);
  if (initializedDirs.has(normalized)) {
    return;
  }
  if (!fs.existsSync(normalized)) {
    fs.mkdirSync(normalized, { recursive: true });
  }
  initializedDirs.add(normalized);
}

function ensureDirectories(): void {
  ensurePathExists(settingsManager.getLogsDir());
  ensurePathExists(settingsManager.getHeadersDir());
}

// In-memory cache for recent log details to provide instant access
const MAX_RECENT_LOGS = 200;
const recentLogsCache = new Map<string, LogDetail>();

/**
 * Clears the in-memory recent logs cache.
 */
export function clearRecentLogsCache(): void {
  recentLogsCache.clear();
}

/** Formats a date or timestamp string into YYYY-MM-DD. */
export function getDateFolder(dateInput?: string | Date): string {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    return dateInput.slice(0, 10);
  }
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns all available date subfolder names (YYYY-MM-DD) sorted descending (newest first).
 * If appId is provided, returns only date subfolders containing logs for that application.
 */
export function getAvailableDateFolders(appId?: string): string[] {
  ensureDirectories();
  const headersDir = settingsManager.getHeadersDir();
  if (!fs.existsSync(headersDir)) return [];

  const dateSet = new Set<string>();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  try {
    const items = fs.readdirSync(headersDir);
    for (const item of items) {
      if (dateRegex.test(item)) {
        const fullPath = path.join(headersDir, item);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            if (!appId) {
              dateSet.add(item);
            } else {
              // Check if at least one request header in this date folder belongs to appId
              let files: string[] = [];
              try {
                files = fs.readdirSync(fullPath).filter(f => f.endsWith('_request.json'));
              } catch {
                continue;
              }
              for (const f of files) {
                try {
                  const reqPath = path.join(fullPath, f);
                  const meta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as ReqMeta;
                  if (meta.appId === appId) {
                    dateSet.add(item);
                    break; // found match for this date, move to next date folder
                  }
                } catch {
                  // ignore corrupted file
                }
              }
            }
          }
        } catch {
          // ignore stat error
        }
      }
    }
  } catch {
    // ignore read error
  }

  // Also include dates from recentLogsCache if matching appId
  if (appId) {
    for (const log of recentLogsCache.values()) {
      if (log.reqMeta?.appId === appId && log.reqMeta.timestamp) {
        const d = getDateFolder(log.reqMeta.timestamp);
        if (d && dateRegex.test(d)) {
          dateSet.add(d);
        }
      }
    }
  }

  return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
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
  error,
  timestamp,
  date
}: SaveLogEntryParams): SaveLogEntryResult {
  ensureDirectories();

  const logsBaseDir = settingsManager.getLogsDir();
  const headersBaseDir = settingsManager.getHeadersDir();
  const isoTimestamp = timestamp || new Date().toISOString();
  const dateFolder = date || getDateFolder(isoTimestamp);

  const targetLogsDir = path.join(logsBaseDir, dateFolder);
  const targetHeadersDir = path.join(headersBaseDir, dateFolder);

  ensurePathExists(targetLogsDir);
  ensurePathExists(targetHeadersDir);

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

  const reqBodyPath = path.join(targetLogsDir, `${id}_request.${reqExt}`);
  const resBodyPath = path.join(targetLogsDir, `${id}_response.${resExt}`);
  const reqHeaderPath = path.join(targetHeadersDir, `${id}_request.json`);
  const resHeaderPath = path.join(targetHeadersDir, `${id}_response.json`);

  const reqBodyContent = requestBody || '';
  const resBodyContent = responseBody || (error ? `Error: ${error}` : '');

  const contentTypeReqStr = Array.isArray(contentTypeReq)
    ? (contentTypeReq[0] ?? 'text/plain')
    : (contentTypeReq ?? 'text/plain');

  const reqMeta: ReqMeta = {
    id,
    appId,
    appName,
    backendName: backendName || null,
    routeType: (routeType as 'backend' | 'redirect') || 'backend',
    timestamp: isoTimestamp,
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

  const reqHeaderContent = JSON.stringify(reqMeta, null, 2);
  const resHeaderContent = JSON.stringify(resMeta, null, 2);

  // Cache recent log detail in memory for instant retrieval
  const detail: LogDetail = {
    id,
    reqMeta,
    resMeta,
    requestBody: reqBodyContent,
    responseBody: resBodyContent
  };
  recentLogsCache.set(id, detail);
  if (recentLogsCache.size > MAX_RECENT_LOGS) {
    const firstKey = recentLogsCache.keys().next().value;
    if (firstKey) recentLogsCache.delete(firstKey);
  }

  // Non-blocking asynchronous file persistence to disk
  Promise.all([
    fs.promises.writeFile(reqBodyPath, reqBodyContent, 'utf8'),
    fs.promises.writeFile(resBodyPath, resBodyContent, 'utf8'),
    fs.promises.writeFile(reqHeaderPath, reqHeaderContent, 'utf8'),
    fs.promises.writeFile(resHeaderPath, resHeaderContent, 'utf8')
  ]).catch(err => {
    console.error(`[LogManager] Error writing log files asynchronously for id ${id}:`, err);
  });

  return { id, reqMeta, resMeta };
}

export function getAllLogs(
  appIdFilter: string | null = null,
  searchText: string | null = null,
  options: LogSearchOptions = {}
): LogEntry[] {
  ensureDirectories();
  const headersBaseDir = settingsManager.getHeadersDir();
  const logsBaseDir = settingsManager.getLogsDir();

  if (!fs.existsSync(headersBaseDir)) return [];

  const availableDates = getAvailableDateFolders();
  const scanDirs: Array<{ headerDir: string; logDir: string }> = [];

  const periodOrDate = (options.period || options.date || '').trim();

  if (options.startDate || options.endDate) {
    const start = options.startDate || '0000-00-00';
    const end = options.endDate || '9999-99-99';
    const matched = availableDates.filter(d => d >= start && d <= end);
    for (const d of matched) {
      scanDirs.push({
        headerDir: path.join(headersBaseDir, d),
        logDir: path.join(logsBaseDir, d)
      });
    }
  } else if (periodOrDate === 'all') {
    // Scan all date folders + root fallback
    for (const d of availableDates) {
      scanDirs.push({
        headerDir: path.join(headersBaseDir, d),
        logDir: path.join(logsBaseDir, d)
      });
    }
    scanDirs.push({ headerDir: headersBaseDir, logDir: logsBaseDir });
  } else if (periodOrDate === 'today') {
    const today = getDateFolder(new Date());
    const specificHeaderDir = path.join(headersBaseDir, today);
    const specificLogDir = path.join(logsBaseDir, today);
    if (fs.existsSync(specificHeaderDir)) {
      scanDirs.push({ headerDir: specificHeaderDir, logDir: specificLogDir });
    }
  } else if (periodOrDate === 'yesterday') {
    const yesterday = getDateFolder(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const specificHeaderDir = path.join(headersBaseDir, yesterday);
    const specificLogDir = path.join(logsBaseDir, yesterday);
    if (fs.existsSync(specificHeaderDir)) {
      scanDirs.push({ headerDir: specificHeaderDir, logDir: specificLogDir });
    }
  } else if (periodOrDate === '7d' || periodOrDate === '30d') {
    const days = periodOrDate === '7d' ? 7 : 30;
    const cutoff = getDateFolder(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const matched = availableDates.filter(d => d >= cutoff);
    for (const d of matched) {
      scanDirs.push({
        headerDir: path.join(headersBaseDir, d),
        logDir: path.join(logsBaseDir, d)
      });
    }
  } else if (periodOrDate && periodOrDate !== 'latest') {
    // Specific date requested (e.g. "2026-09-19")
    const specificHeaderDir = path.join(headersBaseDir, periodOrDate);
    const specificLogDir = path.join(logsBaseDir, periodOrDate);
    if (fs.existsSync(specificHeaderDir)) {
      scanDirs.push({ headerDir: specificHeaderDir, logDir: specificLogDir });
    }
  } else {
    // Default: load ONLY the most recently created date folder
    if (availableDates.length > 0) {
      const latestDate = availableDates[0]!;
      scanDirs.push({
        headerDir: path.join(headersBaseDir, latestDate),
        logDir: path.join(logsBaseDir, latestDate)
      });
    } else {
      // Fallback to legacy root files if no date subfolders exist
      scanDirs.push({ headerDir: headersBaseDir, logDir: logsBaseDir });
    }
  }

  const endpointSearch = (options.endpoint || '').toLowerCase().trim();
  const bodySearch = (options.body || searchText || '').toLowerCase().trim();
  const methodFilter = (options.method || '').toUpperCase().trim();
  const statusFilter = options.status !== undefined && options.status !== null ? String(options.status).trim() : '';

  const logEntries: LogEntry[] = [];

  for (const { headerDir, logDir } of scanDirs) {
    if (!fs.existsSync(headerDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(headerDir);
    } catch {
      continue;
    }

    const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

    for (const file of reqHeaderFiles) {
      try {
        const uuid = file.replace('_request.json', '');
        const reqPath = path.join(headerDir, file);
        const resPath = path.join(headerDir, `${uuid}_response.json`);

        const reqMeta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as ReqMeta;
        let resMeta: Partial<ResMeta> = { statusCode: 500, statusText: 'FAILED', durationMs: 0, headers: {} };

        if (fs.existsSync(resPath)) {
          resMeta = JSON.parse(fs.readFileSync(resPath, 'utf8')) as ResMeta;
        }

        if (appIdFilter && reqMeta.appId !== appIdFilter) {
          continue;
        }

        const endpoint = reqMeta.endpoint || reqMeta.targetUrl || '';

        if (endpointSearch || bodySearch || methodFilter || statusFilter) {
          if (!matchesSearch(
            endpointSearch,
            bodySearch,
            reqMeta,
            resMeta as ResMeta,
            endpoint,
            logDir,
            uuid,
            methodFilter,
            statusFilter
          )) {
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
  }

  // Sort by timestamp descending
  let results = logEntries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (typeof options.offset === 'number' && options.offset > 0) {
    results = results.slice(options.offset);
  }
  if (typeof options.limit === 'number' && options.limit > 0) {
    results = results.slice(0, options.limit);
  }

  return results;
}

function matchesSearch(
  endpointSearch: string,
  bodySearch: string,
  reqMeta: ReqMeta,
  resMeta: ResMeta,
  endpoint: string,
  logsDir: string,
  uuid: string,
  methodFilter?: string,
  statusFilter?: string
): boolean {
  if (methodFilter && (reqMeta.method || '').toUpperCase() !== methodFilter) {
    return false;
  }

  if (statusFilter && String(resMeta.statusCode ?? '') !== statusFilter) {
    return false;
  }

  if (endpointSearch) {
    const tokens = endpointSearch.split(/\s+/).filter(Boolean);
    const candidateFields = [
      (endpoint || '').toLowerCase(),
      (reqMeta.targetUrl || '').toLowerCase(),
      (reqMeta.method || '').toLowerCase(),
      (reqMeta.appName || '').toLowerCase(),
      (reqMeta.backendName || '').toLowerCase(),
      String(resMeta.statusCode ?? '').toLowerCase(),
      (resMeta.statusText || '').toLowerCase(),
      (reqMeta.routeType || '').toLowerCase()
    ];

    for (const token of tokens) {
      const tokenMatch = candidateFields.some(field => field.includes(token));
      if (!tokenMatch) {
        return false;
      }
    }
  }

  if (bodySearch) {
    const tokens = bodySearch.split(/\s+/).filter(Boolean);
    const reqHeadersStr = reqMeta.headers ? JSON.stringify(reqMeta.headers).toLowerCase() : '';
    const resHeadersStr = resMeta.headers ? JSON.stringify(resMeta.headers).toLowerCase() : '';
    const reqBody = (readBodyFile(logsDir, uuid, 'request', reqMeta.fileExtension) || '').toLowerCase();
    const resBody = (readBodyFile(logsDir, uuid, 'response', resMeta.fileExtension) || '').toLowerCase();

    for (const token of tokens) {
      const tokenMatch =
        reqHeadersStr.includes(token) ||
        resHeadersStr.includes(token) ||
        reqBody.includes(token) ||
        resBody.includes(token);
      if (!tokenMatch) {
        return false;
      }
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
  // Fast path: check in-memory LRU cache first
  if (recentLogsCache.has(uuid)) {
    const cached = recentLogsCache.get(uuid);
    if (cached) {
      const body = kind === 'request' ? cached.requestBody : cached.responseBody;
      if (typeof body === 'string') return body;
    }
  }

  try {
    const bodyPath = path.join(logsDir, `${uuid}_${kind}.${extension || 'txt'}`);
    if (!fs.existsSync(bodyPath)) return null;
    return fs.readFileSync(bodyPath, 'utf8');
  } catch {
    return null;
  }
}

export function getLogDetail(id: string, date?: string): LogDetail | null {
  if (recentLogsCache.has(id)) {
    return recentLogsCache.get(id)!;
  }

  ensureDirectories();
  const logsBaseDir = settingsManager.getLogsDir();
  const headersBaseDir = settingsManager.getHeadersDir();

  const candidateDirs: Array<{ headerDir: string; logDir: string }> = [];

  if (date) {
    candidateDirs.push({
      headerDir: path.join(headersBaseDir, date),
      logDir: path.join(logsBaseDir, date)
    });
  } else {
    // Check available date folders (newest first)
    const availableDates = getAvailableDateFolders();
    for (const d of availableDates) {
      candidateDirs.push({
        headerDir: path.join(headersBaseDir, d),
        logDir: path.join(logsBaseDir, d)
      });
    }
    // Also include root fallback
    candidateDirs.push({
      headerDir: headersBaseDir,
      logDir: logsBaseDir
    });
  }

  for (const { headerDir, logDir } of candidateDirs) {
    if (!fs.existsSync(headerDir)) continue;

    const reqHeaderPath = path.join(headerDir, `${id}_request.json`);
    const resHeaderPath = path.join(headerDir, `${id}_response.json`);

    if (fs.existsSync(reqHeaderPath)) {
      try {
        const reqMeta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8')) as ReqMeta;
        const resMeta: ResMeta = fs.existsSync(resHeaderPath)
          ? (JSON.parse(fs.readFileSync(resHeaderPath, 'utf8')) as ResMeta)
          : ({} as ResMeta);

        // Read request body file
        const reqBodyPath = path.join(logDir, `${id}_request.${reqMeta.fileExtension || 'txt'}`);
        let requestBody = '';
        if (fs.existsSync(reqBodyPath)) {
          requestBody = fs.readFileSync(reqBodyPath, 'utf8');
        }

        // Read response body file
        const resBodyPath = path.join(logDir, `${id}_response.${resMeta.fileExtension || 'txt'}`);
        let responseBody = '';
        if (fs.existsSync(resBodyPath)) {
          responseBody = fs.readFileSync(resBodyPath, 'utf8');
        }

        return { id, reqMeta, resMeta, requestBody, responseBody };
      } catch (err) {
        console.error(`Error reading log detail for ${id}:`, err);
        return null;
      }
    }
  }

  return null;
}

export function clearAllLogs(): boolean {
  clearDirectoryCache();
  clearRecentLogsCache();
  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();

  const cleanDir = (baseDir: string) => {
    if (!fs.existsSync(baseDir)) return;
    for (const entry of fs.readdirSync(baseDir)) {
      const fullPath = path.join(baseDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          for (const sub of fs.readdirSync(fullPath)) {
            const subPath = path.join(fullPath, sub);
            try {
              if (fs.statSync(subPath).isFile()) fs.unlinkSync(subPath);
            } catch {
              // ignore
            }
          }
          try {
            fs.rmdirSync(fullPath);
          } catch {
            // ignore
          }
        } else if (stat.isFile()) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.error(`Error clearing ${fullPath}:`, err);
      }
    }
  };

  cleanDir(logsDir);
  cleanDir(headersDir);
  return true;
}

function getAllDirectories(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const dirs: string[] = [baseDir];
  try {
    for (const f of fs.readdirSync(baseDir)) {
      const full = path.join(baseDir, f);
      try {
        if (fs.statSync(full).isDirectory()) {
          dirs.push(full);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return dirs;
}

export function clearLogsForApp(appId: string): number {
  if (!appId) return 0;

  for (const [id, detail] of recentLogsCache.entries()) {
    if (detail.reqMeta.appId === appId) {
      recentLogsCache.delete(id);
    }
  }

  ensureDirectories();
  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  let deleted = 0;

  const headerDirs = getAllDirectories(headersDir);
  const logDirs = getAllDirectories(logsDir);

  for (const hDir of headerDirs) {
    if (!fs.existsSync(hDir)) continue;
    for (const f of fs.readdirSync(hDir)) {
      const fullPath = path.join(hDir, f);
      try {
        if (!fs.statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }

      if (f.endsWith('_request.json') || f.endsWith('_response.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as { appId: string };
          if (meta.appId === appId) {
            fs.unlinkSync(fullPath);
            deleted++;
          }
        } catch {
          // skip
        }
      }
    }
  }

  for (const lDir of logDirs) {
    if (!fs.existsSync(lDir)) continue;
    for (const f of fs.readdirSync(lDir)) {
      const fullPath = path.join(lDir, f);
      try {
        if (!fs.statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }

      const base = f.replace(/_(request|response)\..+$/, '');
      if (base === f) continue;

      // Find if base has a matching request.json in any header dir
      let belongsToApp = false;
      for (const hDir of headerDirs) {
        const reqPath = path.join(hDir, `${base}_request.json`);
        if (fs.existsSync(reqPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as { appId: string };
            if (meta.appId === appId) {
              belongsToApp = true;
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      // If the header was already deleted in previous pass or matched this app
      if (belongsToApp) {
        try {
          fs.unlinkSync(fullPath);
          deleted++;
        } catch {
          // ignore
        }
      }
    }
  }

  return deleted;
}

export function archiveLogsForApp(
  appId: string,
  appName?: string,
  options?: ArchiveOptions
): ArchiveResult {
  if (!appId) return { archived: 0 };

  ensureDirectories();

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  const archivesDir = settingsManager.getArchivesDir();

  const sanitizeName =
    (appName || 'unknown').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'unknown';
  const targetArchiveRoot = path.join(archivesDir, sanitizeName);
  ensurePathExists(targetArchiveRoot);

  const targetIdsSet = options?.ids && options.ids.length > 0 ? new Set(options.ids) : null;

  // Resolve scan directories based on options
  const scanDirs: Array<{ dateFolder: string; headerDir: string; logDir: string }> = [];
  const availableDates = getAvailableDateFolders();

  const periodOrDate = (options?.period || options?.date || '').trim();

  if (options?.startDate || options?.endDate) {
    const start = options.startDate || '0000-00-00';
    const end = options.endDate || '9999-99-99';
    const matched = availableDates.filter(d => d >= start && d <= end);
    for (const d of matched) {
      scanDirs.push({
        dateFolder: d,
        headerDir: path.join(headersDir, d),
        logDir: path.join(logsDir, d)
      });
    }
  } else if (periodOrDate && periodOrDate !== 'all') {
    if (periodOrDate === 'today') {
      const today = getDateFolder(new Date());
      scanDirs.push({ dateFolder: today, headerDir: path.join(headersDir, today), logDir: path.join(logsDir, today) });
    } else if (periodOrDate === 'yesterday') {
      const yesterday = getDateFolder(new Date(Date.now() - 24 * 60 * 60 * 1000));
      scanDirs.push({ dateFolder: yesterday, headerDir: path.join(headersDir, yesterday), logDir: path.join(logsDir, yesterday) });
    } else if (periodOrDate === '7d' || periodOrDate === '30d') {
      const days = periodOrDate === '7d' ? 7 : 30;
      const cutoff = getDateFolder(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
      for (const d of availableDates.filter(d => d >= cutoff)) {
        scanDirs.push({ dateFolder: d, headerDir: path.join(headersDir, d), logDir: path.join(logsDir, d) });
      }
    } else {
      // Specific date
      scanDirs.push({ dateFolder: periodOrDate, headerDir: path.join(headersDir, periodOrDate), logDir: path.join(logsDir, periodOrDate) });
    }
  } else {
    // Scan all date folders + root fallback
    for (const d of availableDates) {
      scanDirs.push({
        dateFolder: d,
        headerDir: path.join(headersDir, d),
        logDir: path.join(logsDir, d)
      });
    }
    scanDirs.push({ dateFolder: '', headerDir: headersDir, logDir: logsDir });
  }

  const archivedTransactions = new Set<string>();
  const archivedDates = new Set<string>();

  for (const { dateFolder, headerDir, logDir } of scanDirs) {
    if (!fs.existsSync(headerDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(headerDir);
    } catch {
      continue;
    }

    const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

    for (const file of reqHeaderFiles) {
      const uuid = file.replace('_request.json', '');
      if (targetIdsSet && !targetIdsSet.has(uuid)) {
        continue;
      }

      const reqHeaderPath = path.join(headerDir, file);
      const resHeaderPath = path.join(headerDir, `${uuid}_response.json`);

      let meta: ReqMeta | null = null;
      try {
        meta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8')) as ReqMeta;
      } catch {
        continue;
      }

      if (meta.appId !== appId) {
        continue;
      }

      // Preserve date partition in archive
      const targetDate = dateFolder || getDateFolder(meta.timestamp) || 'unknown';
      const destHeadersDir = path.join(targetArchiveRoot, 'headers', targetDate);
      const destLogsDir = path.join(targetArchiveRoot, 'logs', targetDate);
      ensurePathExists(destHeadersDir);
      ensurePathExists(destLogsDir);

      const moveOperations: Array<{ src: string; dest: string }> = [];

      // Move request header
      moveOperations.push({ src: reqHeaderPath, dest: path.join(destHeadersDir, file) });

      // Move response header if exists
      if (fs.existsSync(resHeaderPath)) {
        moveOperations.push({ src: resHeaderPath, dest: path.join(destHeadersDir, `${uuid}_response.json`) });
      }

      // Find and move request/response body files in logDir
      if (fs.existsSync(logDir)) {
        try {
          const logFiles = fs.readdirSync(logDir);
          for (const lf of logFiles) {
            if (lf.startsWith(`${uuid}_`)) {
              moveOperations.push({ src: path.join(logDir, lf), dest: path.join(destLogsDir, lf) });
            }
          }
        } catch {
          // Ignore
        }
      }

      // Perform move operations
      for (const { src, dest } of moveOperations) {
        try {
          fs.renameSync(src, dest);
        } catch {
          try {
            fs.copyFileSync(src, dest);
            fs.unlinkSync(src);
          } catch (err) {
            console.error(`Failed to archive file ${src}:`, (err as Error).message);
          }
        }
      }

      recentLogsCache.delete(uuid);
      archivedTransactions.add(uuid);
      archivedDates.add(targetDate);
    }
  }

  // Generate / update manifest.json
  let manifest: ArchiveManifest | undefined;
  try {
    const manifestPath = path.join(targetArchiveRoot, 'manifest.json');
    let prevTransactions = 0;
    const allDates = new Set<string>(archivedDates);

    if (fs.existsSync(manifestPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
        prevTransactions = existing.totalTransactionsArchived || 0;
        if (Array.isArray(existing.dates)) {
          existing.dates.forEach(d => allDates.add(d));
        }
      } catch {
        // Overwrite unparseable manifest
      }
    }

    manifest = {
      appName: appName || sanitizeName,
      appId,
      lastArchivedAt: new Date().toISOString(),
      totalTransactionsArchived: prevTransactions + archivedTransactions.size,
      dates: Array.from(allDates).sort().reverse()
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write archive manifest.json:', err);
  }

  return {
    archived: archivedTransactions.size,
    archivePath: targetArchiveRoot,
    manifest
  };
}

export function deleteLogsByIds(ids: string[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  for (const id of ids) {
    recentLogsCache.delete(id);
  }

  ensureDirectories();

  const logsDir = settingsManager.getLogsDir();
  const headersDir = settingsManager.getHeadersDir();
  const idSet = new Set(ids);
  let deleted = 0;

  const allDirs = [...getAllDirectories(headersDir), ...getAllDirectories(logsDir)];

  for (const dir of allDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      try {
        if (!fs.statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }

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

export function exportLog(id: string, customName: string, date?: string): ExportResult | null {
  const detail = getLogDetail(id, date);
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

/**
 * Lists all archived applications, their metadata, total transactions, and preserved date folders.
 */
export function getArchivedApps(): ArchivedAppSummary[] {
  ensureDirectories();
  const archivesDir = settingsManager.getArchivesDir();
  if (!fs.existsSync(archivesDir)) return [];

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(archivesDir);
  } catch {
    return [];
  }

  const results: ArchivedAppSummary[] = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // skip .gitkeep or hidden files
    const appDir = path.join(archivesDir, entry);
    try {
      if (!fs.statSync(appDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = path.join(appDir, 'manifest.json');
    let manifest: Partial<ArchiveManifest> = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
      } catch {
        // ignore
      }
    }

    // Discover actual date subfolders in headers
    const headersDir = path.join(appDir, 'headers');
    const datesSet = new Set<string>(manifest.dates || []);
    let transactionCount = 0;

    if (fs.existsSync(headersDir)) {
      try {
        const subItems = fs.readdirSync(headersDir);
        for (const sub of subItems) {
          const subPath = path.join(headersDir, sub);
          try {
            if (fs.statSync(subPath).isDirectory()) {
              datesSet.add(sub);
              const headerFiles = fs.readdirSync(subPath).filter(f => f.endsWith('_request.json'));
              transactionCount += headerFiles.length;
            } else if (sub.endsWith('_request.json')) {
              transactionCount++;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    results.push({
      appName: manifest.appName || entry,
      appId: manifest.appId || entry,
      lastArchivedAt: manifest.lastArchivedAt || new Date().toISOString(),
      totalTransactions: manifest.totalTransactionsArchived !== undefined ? manifest.totalTransactionsArchived : transactionCount,
      dates: Array.from(datesSet).sort().reverse()
    });
  }

  return results.sort(
    (a, b) => new Date(b.lastArchivedAt).getTime() - new Date(a.lastArchivedAt).getTime()
  );
}

/**
 * Retrieves archived logs for an application, applying optional date and search query filters.
 */
export function getArchivedLogs(
  appName: string,
  options: LogSearchOptions = {}
): LogEntry[] {
  if (!appName) return [];

  const archivesDir = settingsManager.getArchivesDir();
  const sanitizeName = appName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || appName;
  const appArchiveDir = path.join(archivesDir, sanitizeName);
  const headersBaseDir = path.join(appArchiveDir, 'headers');
  const logsBaseDir = path.join(appArchiveDir, 'logs');

  if (!fs.existsSync(headersBaseDir)) return [];

  const scanDirs: Array<{ headerDir: string; logDir: string }> = [];

  if (options.date && options.date !== 'all') {
    scanDirs.push({
      headerDir: path.join(headersBaseDir, options.date),
      logDir: path.join(logsBaseDir, options.date)
    });
  } else {
    // Scan all date folders + root fallback
    try {
      const items = fs.readdirSync(headersBaseDir);
      for (const item of items) {
        const itemPath = path.join(headersBaseDir, item);
        try {
          if (fs.statSync(itemPath).isDirectory()) {
            scanDirs.push({
              headerDir: itemPath,
              logDir: path.join(logsBaseDir, item)
            });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    scanDirs.push({ headerDir: headersBaseDir, logDir: logsBaseDir });
  }

  const endpointSearch = (options.endpoint || '').toLowerCase().trim();
  const bodySearch = (options.body || '').toLowerCase().trim();
  const methodFilter = (options.method || '').toUpperCase().trim();
  const statusFilter = options.status !== undefined && options.status !== null ? String(options.status).trim() : '';

  const logEntries: LogEntry[] = [];

  for (const { headerDir, logDir } of scanDirs) {
    if (!fs.existsSync(headerDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(headerDir);
    } catch {
      continue;
    }

    const reqHeaderFiles = files.filter(f => f.endsWith('_request.json'));

    for (const file of reqHeaderFiles) {
      try {
        const uuid = file.replace('_request.json', '');
        const reqPath = path.join(headerDir, file);
        const resPath = path.join(headerDir, `${uuid}_response.json`);

        const reqMeta = JSON.parse(fs.readFileSync(reqPath, 'utf8')) as ReqMeta;
        let resMeta: Partial<ResMeta> = { statusCode: 500, statusText: 'FAILED', durationMs: 0, headers: {} };

        if (fs.existsSync(resPath)) {
          resMeta = JSON.parse(fs.readFileSync(resPath, 'utf8')) as ResMeta;
        }

        const endpoint = reqMeta.endpoint || reqMeta.targetUrl || '';

        if (endpointSearch || bodySearch || methodFilter || statusFilter) {
          if (!matchesSearch(
            endpointSearch,
            bodySearch,
            reqMeta,
            resMeta as ResMeta,
            endpoint,
            logDir,
            uuid,
            methodFilter,
            statusFilter
          )) {
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
        console.error(`Error reading archived log ${file}:`, err);
      }
    }
  }

  let results = logEntries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (typeof options.offset === 'number' && options.offset > 0) {
    results = results.slice(options.offset);
  }
  if (typeof options.limit === 'number' && options.limit > 0) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Retrieves full archived log detail by ID for an application.
 */
export function getArchivedLogDetail(
  appName: string,
  id: string,
  date?: string
): LogDetail | null {
  if (!appName || !id) return null;

  const archivesDir = settingsManager.getArchivesDir();
  const sanitizeName = appName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || appName;
  const appArchiveDir = path.join(archivesDir, sanitizeName);
  const headersBaseDir = path.join(appArchiveDir, 'headers');
  const logsBaseDir = path.join(appArchiveDir, 'logs');

  if (!fs.existsSync(headersBaseDir)) return null;

  const candidateDirs: Array<{ headerDir: string; logDir: string }> = [];
  if (date) {
    candidateDirs.push({
      headerDir: path.join(headersBaseDir, date),
      logDir: path.join(logsBaseDir, date)
    });
  }

  try {
    const items = fs.readdirSync(headersBaseDir);
    for (const item of items) {
      if (item === date) continue;
      const p = path.join(headersBaseDir, item);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        candidateDirs.push({
          headerDir: p,
          logDir: path.join(logsBaseDir, item)
        });
      }
    }
  } catch {
    // ignore
  }
  candidateDirs.push({ headerDir: headersBaseDir, logDir: logsBaseDir });

  for (const { headerDir, logDir } of candidateDirs) {
    const reqHeaderPath = path.join(headerDir, `${id}_request.json`);
    const resHeaderPath = path.join(headerDir, `${id}_response.json`);

    if (fs.existsSync(reqHeaderPath)) {
      try {
        const reqMeta = JSON.parse(fs.readFileSync(reqHeaderPath, 'utf8')) as ReqMeta;
        const resMeta: ResMeta = fs.existsSync(resHeaderPath)
          ? (JSON.parse(fs.readFileSync(resHeaderPath, 'utf8')) as ResMeta)
          : ({} as ResMeta);

        const reqBody = readBodyFile(logDir, id, 'request', reqMeta.fileExtension) || '';
        const resBody = readBodyFile(logDir, id, 'response', resMeta.fileExtension) || '';

        return {
          id,
          reqMeta,
          resMeta,
          requestBody: reqBody,
          responseBody: resBody
        };
      } catch (err) {
        console.error(`Error reading archived log detail for ${id}:`, err);
      }
    }
  }

  return null;
}

/**
 * Restores archived logs back into active logs/ and headers/ directories.
 */
export function restoreArchivedLogs(
  appName: string,
  options: { ids?: string[]; date?: string } = {}
): RestoreResult {
  if (!appName) return { restored: 0, appName };

  ensureDirectories();

  const archivesDir = settingsManager.getArchivesDir();
  const sanitizeName = appName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || appName;
  const appArchiveDir = path.join(archivesDir, sanitizeName);
  const archiveHeadersDir = path.join(appArchiveDir, 'headers');
  const archiveLogsDir = path.join(appArchiveDir, 'logs');

  if (!fs.existsSync(archiveHeadersDir)) return { restored: 0, appName: sanitizeName };

  const targetIdsSet = options.ids && options.ids.length > 0 ? new Set(options.ids) : null;
  const activeHeadersBase = settingsManager.getHeadersDir();
  const activeLogsBase = settingsManager.getLogsDir();

  const scanDirs: Array<{ dateFolder: string; headerDir: string; logDir: string }> = [];
  if (options.date) {
    scanDirs.push({
      dateFolder: options.date,
      headerDir: path.join(archiveHeadersDir, options.date),
      logDir: path.join(archiveLogsDir, options.date)
    });
  } else {
    try {
      const items = fs.readdirSync(archiveHeadersDir);
      for (const item of items) {
        const itemPath = path.join(archiveHeadersDir, item);
        if (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory()) {
          scanDirs.push({
            dateFolder: item,
            headerDir: itemPath,
            logDir: path.join(archiveLogsDir, item)
          });
        }
      }
    } catch {
      // ignore
    }
    scanDirs.push({ dateFolder: '', headerDir: archiveHeadersDir, logDir: archiveLogsDir });
  }

  const restoredTransactions = new Set<string>();

  for (const { dateFolder, headerDir, logDir } of scanDirs) {
    if (!fs.existsSync(headerDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(headerDir);
    } catch {
      continue;
    }

    const reqFiles = files.filter(f => f.endsWith('_request.json'));

    for (const file of reqFiles) {
      const uuid = file.replace('_request.json', '');
      if (targetIdsSet && !targetIdsSet.has(uuid)) {
        continue;
      }

      const reqHeaderSrc = path.join(headerDir, file);
      const resHeaderSrc = path.join(headerDir, `${uuid}_response.json`);

      let meta: ReqMeta | null = null;
      try {
        meta = JSON.parse(fs.readFileSync(reqHeaderSrc, 'utf8')) as ReqMeta;
      } catch {
        continue;
      }

      const targetDate = dateFolder || getDateFolder(meta.timestamp) || getDateFolder(new Date());
      const destHeaderDir = path.join(activeHeadersBase, targetDate);
      const destLogDir = path.join(activeLogsBase, targetDate);

      ensurePathExists(destHeaderDir);
      ensurePathExists(destLogDir);

      const moves: Array<{ src: string; dest: string }> = [];
      moves.push({ src: reqHeaderSrc, dest: path.join(destHeaderDir, file) });
      if (fs.existsSync(resHeaderSrc)) {
        moves.push({ src: resHeaderSrc, dest: path.join(destHeaderDir, `${uuid}_response.json`) });
      }

      if (fs.existsSync(logDir)) {
        try {
          const lFiles = fs.readdirSync(logDir);
          for (const lf of lFiles) {
            if (lf.startsWith(`${uuid}_`)) {
              moves.push({ src: path.join(logDir, lf), dest: path.join(destLogDir, lf) });
            }
          }
        } catch {
          // ignore
        }
      }

      for (const { src, dest } of moves) {
        try {
          fs.renameSync(src, dest);
        } catch {
          try {
            fs.copyFileSync(src, dest);
            fs.unlinkSync(src);
          } catch (err) {
            console.error(`Failed to restore ${src}:`, err);
          }
        }
      }

      restoredTransactions.add(uuid);
    }
  }

  // Clean up empty date subdirectories in headers and logs
  for (const { dateFolder, headerDir, logDir } of scanDirs) {
    if (dateFolder) {
      if (fs.existsSync(headerDir)) {
        try {
          const rem = fs.readdirSync(headerDir).filter(f => !f.startsWith('.'));
          if (rem.length === 0) fs.rmdirSync(headerDir);
        } catch {
          // ignore
        }
      }
      if (fs.existsSync(logDir)) {
        try {
          const rem = fs.readdirSync(logDir).filter(f => !f.startsWith('.'));
          if (rem.length === 0) fs.rmdirSync(logDir);
        } catch {
          // ignore
        }
      }
    }
  }

  // Recalculate surviving dates and transactions in archive
  const survivingDates = new Set<string>();
  let remainingTransactions = 0;
  if (fs.existsSync(archiveHeadersDir)) {
    try {
      const subs = fs.readdirSync(archiveHeadersDir);
      for (const sub of subs) {
        if (sub.startsWith('.')) continue;
        const subPath = path.join(archiveHeadersDir, sub);
        try {
          if (fs.statSync(subPath).isDirectory()) {
            const hFiles = fs.readdirSync(subPath).filter(f => f.endsWith('_request.json'));
            if (hFiles.length > 0) {
              survivingDates.add(sub);
              remainingTransactions += hFiles.length;
            }
          } else if (sub.endsWith('_request.json')) {
            remainingTransactions++;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // Update or delete manifest.json
  const manifestPath = path.join(appArchiveDir, 'manifest.json');
  if (remainingTransactions === 0) {
    try {
      if (typeof fs.rmSync === 'function') {
        fs.rmSync(appArchiveDir, { recursive: true, force: true });
      } else {
        deleteDirectoryRecursive(appArchiveDir);
      }
    } catch {
      // ignore
    }
  } else if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
      existing.totalTransactionsArchived = remainingTransactions;
      existing.dates = Array.from(survivingDates).sort().reverse();
      fs.writeFileSync(manifestPath, JSON.stringify(existing, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  return {
    restored: restoredTransactions.size,
    appName: sanitizeName
  };
}

/**
 * Permanently deletes an application's archive folder (or a specific historical date folder) from disk.
 */
export function deleteArchivedApp(appName: string, date?: string): boolean {
  if (!appName) return false;

  const archivesDir = settingsManager.getArchivesDir();
  const sanitizeName = appName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || appName;
  const appArchiveDir = path.join(archivesDir, sanitizeName);

  if (!fs.existsSync(appArchiveDir)) return false;

  if (date && date !== 'all') {
    const headerDateDir = path.join(appArchiveDir, 'headers', date);
    const logDateDir = path.join(appArchiveDir, 'logs', date);

    if (fs.existsSync(headerDateDir)) {
      try {
        if (typeof fs.rmSync === 'function') {
          fs.rmSync(headerDateDir, { recursive: true, force: true });
        } else {
          deleteDirectoryRecursive(headerDateDir);
        }
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(logDateDir)) {
      try {
        if (typeof fs.rmSync === 'function') {
          fs.rmSync(logDateDir, { recursive: true, force: true });
        } else {
          deleteDirectoryRecursive(logDateDir);
        }
      } catch {
        // ignore
      }
    }

    // Recalculate surviving dates & transactions
    const archiveHeadersDir = path.join(appArchiveDir, 'headers');
    const survivingDates = new Set<string>();
    let remainingTransactions = 0;

    if (fs.existsSync(archiveHeadersDir)) {
      try {
        const subs = fs.readdirSync(archiveHeadersDir);
        for (const sub of subs) {
          if (sub.startsWith('.')) continue;
          const subPath = path.join(archiveHeadersDir, sub);
          try {
            if (fs.statSync(subPath).isDirectory()) {
              const hFiles = fs.readdirSync(subPath).filter(f => f.endsWith('_request.json'));
              if (hFiles.length > 0) {
                survivingDates.add(sub);
                remainingTransactions += hFiles.length;
              }
            } else if (sub.endsWith('_request.json')) {
              remainingTransactions++;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    if (remainingTransactions === 0) {
      try {
        if (typeof fs.rmSync === 'function') {
          fs.rmSync(appArchiveDir, { recursive: true, force: true });
        } else {
          deleteDirectoryRecursive(appArchiveDir);
        }
      } catch {
        // ignore
      }
    } else {
      const manifestPath = path.join(appArchiveDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
          existing.totalTransactionsArchived = remainingTransactions;
          existing.dates = Array.from(survivingDates).sort().reverse();
          fs.writeFileSync(manifestPath, JSON.stringify(existing, null, 2), 'utf8');
        } catch {
          // ignore
        }
      }
    }

    return true;
  }

  try {
    if (typeof fs.rmSync === 'function') {
      fs.rmSync(appArchiveDir, { recursive: true, force: true });
    } else {
      deleteDirectoryRecursive(appArchiveDir);
    }
    return true;
  } catch (err) {
    console.error(`Failed to delete archive ${appArchiveDir}:`, err);
    return false;
  }
}

function deleteDirectoryRecursive(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    if (fs.statSync(full).isDirectory()) {
      deleteDirectoryRecursive(full);
    } else {
      fs.unlinkSync(full);
    }
  }
  fs.rmdirSync(dirPath);
}
