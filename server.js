const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const { proxyMiddleware } = require('./src/services/proxyEngine');
const configManager = require('./src/services/configManager');
const logManager = require('./src/services/logManager');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS
app.use(cors());

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Administrative REST API routes
app.use('/api', apiRoutes);

// Explicit Proxy endpoint: /proxy/:appId/*
app.use('/proxy/:appId', proxyMiddleware);

// Global proxy handler if header X-Proxy-App-Id is present
app.use((req, res, next) => {
  if (req.headers['x-proxy-app-id']) {
    return proxyMiddleware(req, res, next);
  }
  next();
});

// Fallback to index.html for single-page app routes if not an API or proxy call
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize default configs
configManager.getApplications();

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  🚀 PROXY SERVER LOG TOOL RUNNING ON PORT ${PORT}`);
  console.log(`  🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`  🔀 Proxy Route: http://localhost:${PORT}/proxy/<appId>/...`);
  console.log(`====================================================`);
});
