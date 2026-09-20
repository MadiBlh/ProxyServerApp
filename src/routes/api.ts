import express, { Request, Response, Router } from 'express';
import * as configManager from '../services/configManager';
import * as logManager from '../services/logManager';
import * as replayService from '../services/replayService';
import * as proxyEngine from '../services/proxyEngine';
import * as redirectProxyManager from '../services/redirectProxyManager';
import * as settingsManager from '../services/settingsManager';
import type { LogSearchOptions } from '../types';

const router: Router = express.Router();

// Helper to extract string param safely
const getParam = (req: Request, name: string): string => {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : (val || '');
};

// JSON parser for administrative API endpoints
router.use(express.json());

// --- Settings API (Storage & Directory Paths) ---

// Get current storage & paths settings
router.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json(settingsManager.getSettings());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update storage & paths settings
router.put('/settings', (req: Request, res: Response) => {
  try {
    const { configDir, logsDir, migrateExistingConfig } = req.body;
    const updated = settingsManager.updateSettings({
      configDir,
      logsDir,
      migrateExistingConfig: Boolean(migrateExistingConfig)
    });
    // Invalidate config cache and synchronize redirect proxies with the new configuration
    configManager.clearConfigCache();
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- Applications API ---

// Get all applications
router.get('/applications', (_req: Request, res: Response) => {
  const apps = configManager.getApplications();
  res.json(apps);
});

// Create application
router.post('/applications', async (req: Request, res: Response) => {
  try {
    const newApp = await configManager.createApplicationAsync(req.body);
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.status(201).json(newApp);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Update application
router.put('/applications/:id', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const updated = await configManager.updateApplicationAsync(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Application not found' });
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Delete application
router.delete('/applications/:id', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  const deleted = configManager.deleteApplication(id);
  if (!deleted) return res.status(404).json({ error: 'Application not found' });
  redirectProxyManager.syncRedirectProxies(configManager.getApplications());
  res.json({ success: true });
});

// Get active redirect proxy servers status
router.get('/redirect-proxies', (_req: Request, res: Response) => {
  res.json(redirectProxyManager.getRunningRedirects());
});

// --- Logs API ---

// Get available date folders (optionally filtered by appId)
router.get('/logs/dates', (req: Request, res: Response) => {
  try {
    const appId = (req.query.appId as string) || undefined;
    const dates = logManager.getAvailableDateFolders(appId);
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get logs list
router.get('/logs', (req: Request, res: Response) => {
  const appId = (req.query.appId as string) || null;
  const q = (req.query.q as string) || null;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
  const searchOpts: LogSearchOptions = {
    endpoint: (req.query.endpoint as string) || '',
    body: (req.query.body as string) || '',
    method: (req.query.method as string) || undefined,
    status: (req.query.status as string) || undefined,
    date: (req.query.date as string) || undefined,
    period: (req.query.period as string) || undefined,
    startDate: (req.query.startDate as string) || undefined,
    endDate: (req.query.endDate as string) || undefined,
    limit: !isNaN(limit as number) ? limit : undefined,
    offset: !isNaN(offset as number) ? offset : undefined
  };
  const logs = logManager.getAllLogs(appId, q, searchOpts);
  res.json(logs);
});

// Get log detail
router.get('/logs/:id', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  const date = (req.query.date as string) || undefined;
  const detail = logManager.getLogDetail(id, date);
  if (!detail) return res.status(404).json({ error: 'Log not found' });
  res.json(detail);
});

// Clear all logs, logs for an app, or specific log IDs
router.delete('/logs', (req: Request, res: Response) => {
  try {
    const { appId, ids } = req.body || {};

    if (Array.isArray(ids) && ids.length > 0) {
      const deleted = logManager.deleteLogsByIds(ids as string[]);
      return res.json({ success: true, deleted, message: `${deleted} log(s) removed` });
    }

    if (appId) {
      const deleted = logManager.clearLogsForApp(appId as string);
      return res.json({ success: true, appId, deleted, message: 'Logs cleared for application' });
    }
    logManager.clearAllLogs();
    res.json({ success: true, message: 'All log files removed successfully' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Archive logs for an application (supports full app, selective IDs, or date-filtered archiving)
router.post('/logs/archive', (req: Request, res: Response) => {
  try {
    const { appId, appName, ids, date, period, startDate, endDate } = req.body || {};
    if (!appId) return res.status(400).json({ error: 'appId is required' });

    const archiveOpts = {
      ids: Array.isArray(ids) ? (ids as string[]) : undefined,
      date: typeof date === 'string' ? date : undefined,
      period: typeof period === 'string' ? period : undefined,
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined
    };

    const result = logManager.archiveLogsForApp(
      appId as string,
      appName as string | undefined,
      archiveOpts
    );
    res.json({
      success: true,
      archived: result.archived,
      archivePath: result.archivePath,
      manifest: result.manifest,
      message: result.archived > 0
        ? `${result.archived} log(s) archived successfully`
        : 'No logs found to archive'
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all archived applications with metadata
router.get('/archives', (_req: Request, res: Response) => {
  try {
    const archives = logManager.getArchivedApps();
    res.json(archives);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List logs within an application archive
router.get('/archives/:appName/logs', (req: Request, res: Response) => {
  try {
    const appName = getParam(req, 'appName');
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const searchOpts: LogSearchOptions = {
      endpoint: (req.query.endpoint as string) || (req.query.q as string) || '',
      body: (req.query.body as string) || '',
      method: (req.query.method as string) || undefined,
      status: (req.query.status as string) || undefined,
      date: (req.query.date as string) || undefined,
      limit: !isNaN(limit as number) ? limit : undefined,
      offset: !isNaN(offset as number) ? offset : undefined
    };
    const logs = logManager.getArchivedLogs(appName, searchOpts);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get detail of a specific archived log
router.get('/archives/:appName/logs/:id', (req: Request, res: Response) => {
  try {
    const appName = getParam(req, 'appName');
    const id = getParam(req, 'id');
    const date = (req.query.date as string) || undefined;
    const detail = logManager.getArchivedLogDetail(appName, id, date);
    if (!detail) return res.status(404).json({ error: 'Archived log not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Restore archived logs back into active logs
router.post('/archives/:appName/restore', (req: Request, res: Response) => {
  try {
    const appName = getParam(req, 'appName');
    const { ids, date } = req.body || {};
    const result = logManager.restoreArchivedLogs(appName, {
      ids: Array.isArray(ids) ? ids : undefined,
      date: typeof date === 'string' ? date : undefined
    });
    res.json({
      success: true,
      restored: result.restored,
      appName: result.appName,
      message: result.restored > 0
        ? `${result.restored} log(s) restored successfully to active logs`
        : 'No logs found to restore'
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete an entire application archive or a specific historical date folder
router.delete('/archives/:appName', (req: Request, res: Response) => {
  try {
    const appName = getParam(req, 'appName');
    const date = (req.query.date as string) || (req.body && req.body.date) || undefined;
    const deleted = logManager.deleteArchivedApp(appName, date);
    if (!deleted) return res.status(404).json({ error: 'Archive not found' });
    res.json({
      success: true,
      message: date ? `Archived date folder "${date}" deleted for "${appName}"` : `Archive for "${appName}" deleted`
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete a single log by id
router.delete('/logs/:id', (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const deleted = logManager.deleteLogsByIds([id]);
    if (deleted === 0) return res.status(404).json({ error: 'Log not found' });
    res.json({ success: true, deleted, message: 'Log removed' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Export selected request & response log file
router.post('/logs/:id/export', (req: Request, res: Response) => {
  const id = getParam(req, 'id');
  const { fileName, date } = req.body || {};
  if (!fileName) return res.status(400).json({ error: 'File name prefix is required' });

  const result = logManager.exportLog(id, fileName, date);
  if (!result) return res.status(404).json({ error: 'Log not found' });

  res.json({
    success: true,
    message: 'Log exported successfully',
    files: result
  });
});

// Replay request
router.post('/logs/:id/replay', async (req: Request, res: Response) => {
  try {
    const id = getParam(req, 'id');
    const { customUrl, customMethod, customHeaders, customBody } = req.body;
    const result = await replayService.replayRequest({
      logId: id,
      customUrl,
      customMethod,
      customHeaders,
      customBody
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- SSE Realtime Feed ---
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  proxyEngine.registerSseClient(res);

  req.on('close', () => {
    proxyEngine.unregisterSseClient(res);
  });
});

// Fallback for non-admin /api routes (e.g. /api/users, /api/v1/...) -> pass to proxy
router.use((_req: Request, _res: Response, next) => {
  next();
});

export default router;
