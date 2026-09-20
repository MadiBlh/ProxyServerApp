/**
 * Shared TypeScript interfaces and types for ProxyServerApp.
 * All modules import their domain types from here.
 */

import type { Response } from 'express';

// =============================================================================
// Application Configuration Types
// =============================================================================

/** A backend service URL entry associated with an application. */
export interface BackendUrl {
  id: string;
  name: string;
  url: string;
  pathPrefix: string;
}

/** A redirect URL entry — gets its own dedicated proxy server on `port`. */
export interface RedirectUrl {
  id: string;
  name: string;
  targetUrl: string;
  port: number;
}

/** A configured web application with backend and redirect URL mappings. */
export interface Application {
  id: string;
  name: string;
  frontEndUrl: string;
  backendUrls: BackendUrl[];
  redirectUrls: RedirectUrl[];
  isActive: boolean;
}

/** Input accepted when creating or updating an application. */
export interface CreateApplicationInput {
  id?: string;
  name?: string;
  frontEndUrl?: string;
  backendUrls?: Partial<BackendUrl>[];
  redirectUrls?: Partial<RedirectUrl>[];
  isActive?: boolean;
}
export type UpdateApplicationInput = CreateApplicationInput;

// =============================================================================
// Log Types
// =============================================================================

/**
 * Metadata written to `headers/<id>_request.json`.
 * Stored alongside the request body file.
 */
export interface ReqMeta {
  id: string;
  appId: string;
  appName: string;
  backendName: string | null;
  routeType: 'backend' | 'redirect';
  timestamp: string;        // ISO 8601
  method: string;
  endpoint: string;
  targetUrl: string;
  contentType: string;
  fileExtension: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Metadata written to `headers/<id>_response.json`.
 * Stored alongside the response body file.
 */
export interface ResMeta {
  id: string;
  appId: string;
  statusCode: number;
  statusText: 'OK' | 'FAILED';
  durationMs: number;
  contentType: string;
  fileExtension: string;
  headers: Record<string, string | string[] | undefined>;
  error: string | null;
}

/** List-level log summary (returned by `getAllLogs`). */
export interface LogEntry {
  id: string;
  appId: string;
  appName: string;
  backendName: string | null;
  routeType: 'backend' | 'redirect';
  timestamp: string;
  method: string;
  endpoint: string;
  targetUrl: string;
  statusCode: number;
  status: string;
  durationMs: number;
  requestExt: string;
  responseExt: string;
}

/** Full log detail (returned by `getLogDetail`). */
export interface LogDetail {
  id: string;
  reqMeta: ReqMeta;
  resMeta: ResMeta;
  requestBody: string;
  responseBody: string;
}

/** Parameters accepted by `logManager.saveLogEntry()`. */
export interface SaveLogEntryParams {
  id: string;
  appId: string;
  appName: string;
  backendName?: string | null;
  routeType?: 'backend' | 'redirect';
  targetUrl: string;
  method?: string;
  endpoint?: string;
  requestHeaders: Record<string, string | string[] | undefined>;
  requestBody?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string | string[] | undefined> | null;
  responseBody?: string;
  durationMs?: number;
  error?: string;
  timestamp?: string;
  date?: string;
}

/** Return type of `logManager.saveLogEntry()`. */
export interface SaveLogEntryResult {
  id: string;
  reqMeta: ReqMeta;
  resMeta: ResMeta;
}

/** Search/filter options for `logManager.getAllLogs()`. */
export interface LogSearchOptions {
  endpoint?: string;
  body?: string;
  method?: string;
  status?: string | number;
  date?: string;
  period?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/** Options for archiving logs in `logManager.archiveLogsForApp()`. */
export interface ArchiveOptions {
  ids?: string[];
  date?: string;
  period?: string;
  startDate?: string;
  endDate?: string;
}

/** Archive manifest metadata stored in `archives/<appName>/manifest.json`. */
export interface ArchiveManifest {
  appName: string;
  appId: string;
  lastArchivedAt: string;
  totalTransactionsArchived: number;
  dates: string[];
}

/** Summary of an archived application returned by `logManager.getArchivedApps()`. */
export interface ArchivedAppSummary {
  appName: string;
  appId: string;
  lastArchivedAt: string;
  totalTransactions: number;
  dates: string[];
}

/** Result of `logManager.restoreArchivedLogs()`. */
export interface RestoreResult {
  restored: number;
  appName: string;
}

/** Result of `logManager.archiveLogsForApp()`. */
export interface ArchiveResult {
  archived: number;
  archivePath?: string;
  manifest?: ArchiveManifest;
}

/** Result of `logManager.exportLog()`. */
export interface ExportResult {
  downloadPath: string;
  requestFile: string;
  responseFile: string;
}

// =============================================================================
// Replay Types
// =============================================================================

/** Options accepted by `replayService.replayRequest()`. */
export interface ReplayOptions {
  logId: string;
  customUrl?: string;
  customMethod?: string;
  customHeaders?: Record<string, string>;
  customBody?: string;
}

/** Result returned by `replayService.replayRequest()`. */
export interface ReplayResult {
  success: boolean;
  statusCode: number;
  statusText: string;
  durationMs: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

// =============================================================================
// Settings Types
// =============================================================================

/** Current effective path settings returned by `settingsManager.getSettings()`. */
export interface AppSettings {
  configDir: string;
  logsBaseDir: string;
  logsDir: string;
  headersDir: string;
  archivesDir: string;
  isDefaultConfig: boolean;
  isDefaultLogs: boolean;
  defaults: {
    configDir: string;
    logsBaseDir: string;
    logsDir: string;
    headersDir: string;
    archivesDir: string;
  };
}

/** Input accepted by `settingsManager.updateSettings()`. */
export interface UpdateSettingsInput {
  configDir?: string;
  logsDir?: string;
  migrateExistingConfig?: boolean;
}

// =============================================================================
// Proxy / Redirect Proxy Types
// =============================================================================

/**
 * A subscriber registered on a redirect proxy port.
 * Represents one (app, redirectUrl) pair that shares the port.
 */
export interface RedirectSubscriber {
  app: Application;
  redirect: RedirectUrl;
}

/**
 * Internal entry stored in `runningProxies` Map inside redirectProxyManager.
 * Kept as a partial type here to avoid importing http-proxy directly into types.
 */
export interface ProxyEntry {
  port: number;
  targetUrl: string;
  subscribers: RedirectSubscriber[];
}

/** Status object returned by `redirectProxyManager.getRunningRedirects()`. */
export interface RunningRedirectProxy {
  id: string;
  name: string;
  port: number;
  targetUrl: string;
  appId: string;
  appName: string;
  localUrl: string;
  subscribersCount: number;
}

/** SSE client — an Express Response object kept open for streaming. */
export type SseClient = Response;

// =============================================================================
// Express Request Augmentation
// =============================================================================

/**
 * Extended properties attached to Express Request objects by the proxy middleware.
 * These are not present in the base Express type, so we augment the namespace.
 */
declare global {
  namespace Express {
    interface Request {
      /** Raw body string captured before proxying */
      _proxyRawBodyStr?: string;
      /** Raw body Buffer captured before proxying */
      _proxyRawBuffer?: Buffer;
      /** Unique request ID assigned by proxyEngine */
      _proxyRequestId?: string;
      /** Wall-clock start time (ms since epoch) */
      _proxyStartTime?: number;
      /** The matched Application for this request */
      _proxyApp?: import('./index').Application;
      /** The matched backend/redirect service for this request */
      _proxyBackendService?: (import('./index').BackendUrl | import('./index').RedirectUrl) & { routeType: 'backend' | 'redirect'; url: string };
      /** The resolved backend target URL */
      _proxyTargetUrl?: string;

      /** Redirect proxy: raw body string */
      _redirectRawBodyStr?: string;
      /** Redirect proxy: raw body Buffer */
      _redirectRawBuffer?: Buffer;
      /** Redirect proxy: unique request ID */
      _redirectRequestId?: string;
      /** Redirect proxy: start time */
      _redirectStartTime?: number;
      /** Redirect proxy: resolved subscriber */
      _redirectSubscriber?: import('./index').RedirectSubscriber;
    }
  }
}
