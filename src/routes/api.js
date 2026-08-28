const express = require('express');
const router = express.Router();
const configManager = require('../services/configManager');
const logManager = require('../services/logManager');
const replayService = require('../services/replayService');
const proxyEngine = require('../services/proxyEngine');
const redirectProxyManager = require('../services/redirectProxyManager');
const settingsManager = require('../services/settingsManager');

// JSON parser for administrative API endpoints
router.use(express.json());

// --- Settings API (Storage & Directory Paths) ---

// Get current storage & paths settings
router.get('/settings', (req, res) => {
  try {
    res.json(settingsManager.getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update storage & paths settings
router.put('/settings', (req, res) => {
  try {
    const { configDir, logsDir, migrateExistingConfig } = req.body;
    const updated = settingsManager.updateSettings({
      configDir,
      logsDir,
      migrateExistingConfig: Boolean(migrateExistingConfig)
    });
    // Synchronize redirect proxies with the new configuration
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Applications API ---

// Get all applications
router.get('/applications', (req, res) => {
  const apps = configManager.getApplications();
  res.json(apps);
});

// Create application
router.post('/applications', (req, res) => {
  try {
    const newApp = configManager.createApplication(req.body);
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.status(201).json(newApp);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update application
router.put('/applications/:id', (req, res) => {
  try {
    const updated = configManager.updateApplication(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Application not found' });
    redirectProxyManager.syncRedirectProxies(configManager.getApplications());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete application
router.delete('/applications/:id', (req, res) => {
  const deleted = configManager.deleteApplication(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Application not found' });
  redirectProxyManager.syncRedirectProxies(configManager.getApplications());
  res.json({ success: true });
});

// Get active redirect proxy servers status
router.get('/redirect-proxies', (req, res) => {
  res.json(redirectProxyManager.getRunningRedirects());
});

// --- Logs API ---

// Get logs list
router.get('/logs', (req, res) => {
  const appId = req.query.appId || null;
  const logs = logManager.getAllLogs(appId);
  res.json(logs);
});

// Get log detail
router.get('/logs/:id', (req, res) => {
  const detail = logManager.getLogDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Log not found' });
  res.json(detail);
});

// Clear all logs
router.delete('/logs', (req, res) => {
  try {
    logManager.clearAllLogs();
    res.json({ success: true, message: 'All log files removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export selected request & response log file
router.post('/logs/:id/export', (req, res) => {
  const { fileName } = req.body;
  if (!fileName) return res.status(400).json({ error: 'File name prefix is required' });

  const result = logManager.exportLog(req.params.id, fileName);
  if (!result) return res.status(404).json({ error: 'Log not found' });

  res.json({
    success: true,
    message: 'Log exported successfully',
    files: result
  });
});

// Replay request
router.post('/logs/:id/replay', async (req, res) => {
  try {
    const { customUrl, customMethod, customHeaders, customBody } = req.body;
    const result = await replayService.replayRequest({
      logId: req.params.id,
      customUrl,
      customMethod,
      customHeaders,
      customBody
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SSE Realtime Feed ---
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  proxyEngine.registerSseClient(res);

  req.on('close', () => {
    proxyEngine.unregisterSseClient(res);
  });
});

// Fallback for non-admin /api routes (e.g. /api/users, /api/v1/...) -> pass to proxy
router.use((req, res, next) => {
  next();
});

module.exports = router;
