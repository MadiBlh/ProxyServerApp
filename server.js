require('./src/utils/bootstrap');

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const { proxyMiddleware } = require('./src/services/proxyEngine');
const configManager = require('./src/services/configManager');

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

// Initialize default configs
configManager.getApplications();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  🚀 PROXY SERVER LOG TOOL RUNNING ON PORT ${PORT}`);
  console.log(`  🌐 Dashboard UI: http://localhost:${PORT}/dashboard`);
  console.log(`  📖 Documentation: http://localhost:${PORT}/doc`);
  console.log(`  🔀 Proxy Target:  http://localhost:${PORT}`);
  console.log(`====================================================`);
});
