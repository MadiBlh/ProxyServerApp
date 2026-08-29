require('./src/utils/bootstrap');

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const { proxyMiddleware, sseClients } = require('./src/services/proxyEngine');
const configManager = require('./src/services/configManager');
const redirectProxyManager = require('./src/services/redirectProxyManager');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS
app.use(cors());

// 1. Dashboard Admin Management API (/dashboard-api/applications, /dashboard-api/logs, /dashboard-api/events)
app.use('/dashboard-api', apiRoutes);

// 2. Dashboard UI Static Assets (/dashboard-static/css, /dashboard-static/js)
app.use('/dashboard-static', express.static(path.join(__dirname, 'public')));

// 3. Dashboard UI Page: http://localhost:4000/dashboard
app.get(['/dashboard', '/dashboard/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3b. Code Documentation Page: http://localhost:4000/doc
app.get(['/doc', '/doc/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'doc.html'));
});

// 4. Redirect browser navigation at root GET / to /dashboard
app.get('/', (req, res, next) => {
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html') && !req.headers['x-proxy-app-id'] && !req.headers['x-app-id']) {
    return res.redirect('/dashboard');
  }
  next();
});

// 5. Proxy Server Entrypoint: http://localhost:4000
//    ALL requests (e.g. Vite target: 'http://localhost:4000' forwarding /api/users, /api/todos, etc.)
//    pass through proxyMiddleware to the configured backend microservices.
app.use(proxyMiddleware);

// --- Initialisation ---

// Load config; migrate any legacy redirect URLs that still have pathPrefix but no port
let apps = configManager.getApplications();
let migrated = false;
apps = apps.map(app => {
  const updatedRedirects = (app.redirectUrls || []).map(red => {
    const targetUrl = red.targetUrl || red.url || '';
    if (!red.port) {
      migrated = true;
      return {
        id: red.id,
        name: red.name,
        targetUrl: targetUrl,
        port: configManager.assignRedirectPort(undefined, targetUrl, apps, app.id, red.id)
      };
    }
    return red;
  });
  return { ...app, redirectUrls: updatedRedirects };
});
if (migrated) {
  configManager.saveApplications(apps);
  console.log('  [Migration] Assigned ports to legacy redirect URL entries.');
}

// Share SSE clients array so redirect proxies broadcast to the same dashboard feed
redirectProxyManager.setSseClients(sseClients);

// Start dedicated proxy servers for all active redirect URLs
redirectProxyManager.syncRedirectProxies(apps);

app.listen(PORT, '0.0.0.0', () => {
  const redirectList = redirectProxyManager.getRunningRedirects();
  console.log(`====================================================`);
  console.log(`  🚀 PROXY SERVER LOG TOOL RUNNING ON PORT ${PORT}`);
  console.log(`  🌐 Dashboard UI: http://localhost:${PORT}/dashboard`);
  console.log(`  📖 Documentation: http://localhost:${PORT}/doc`);
  console.log(`  🔀 Main Proxy:    http://localhost:${PORT}`);
  if (redirectList.length > 0) {
    console.log(`  --- Redirect Proxies ---`);
    redirectList.forEach(r => {
      console.log(`  🔀 ${r.name.padEnd(20)} http://localhost:${r.port}  →  ${r.targetUrl}`);
    });
  }
  console.log(`====================================================`);
});
