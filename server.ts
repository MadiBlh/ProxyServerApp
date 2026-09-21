import './src/utils/bootstrap';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import apiRoutes from './src/routes/api';
import { proxyMiddleware, sseClients, closeAllSseClients } from './src/services/proxyEngine';
import * as configManager from './src/services/configManager';
import * as redirectProxyManager from './src/services/redirectProxyManager';
import type { Application, RedirectUrl } from './src/types';

export const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Enable CORS and Response Compression
app.use(cors());
app.use(compression({
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression'] || req.path === '/dashboard-api/events') {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// 1. Dashboard Admin Management API (/dashboard-api/applications, /dashboard-api/logs, /dashboard-api/events)
app.use('/dashboard-api', apiRoutes);

const isDist = __dirname.replace(/\\/g, '/').endsWith('/dist');
const PUBLIC_DIR = isDist
  ? path.resolve(__dirname, '../public')
  : path.resolve(__dirname, 'public');
const MONACO_DIR = isDist
  ? path.resolve(__dirname, '../node_modules/monaco-editor/min/vs')
  : path.resolve(__dirname, 'node_modules/monaco-editor/min/vs');

// 2. Dashboard UI Static Assets (/dashboard-static/vendor/monaco, /dashboard-static/css, /dashboard-static/js)
app.use('/dashboard-static/vendor/monaco', express.static(MONACO_DIR));
app.use('/dashboard-static', express.static(PUBLIC_DIR));

// 3. Dashboard UI Page: http://localhost:4000/dashboard
app.get(['/dashboard', '/dashboard/*'], (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 3b. Code Documentation Page: http://localhost:4000/doc
app.get(['/doc', '/doc/*'], (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'doc.html'));
});

// 3c. Dedicated Archives Page: http://localhost:4000/archives
app.get(['/archives', '/archives/*'], (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'archives.html'));
});

// 3d. Dedicated Mocking & Interception Page: http://localhost:4000/mocking
app.get(['/mocking', '/mocking/*'], (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'mocking.html'));
});

// 4. Redirect browser navigation at root GET / to /dashboard
app.get('/', (req: Request, res: Response, next: NextFunction) => {
  const accept = req.headers['accept'] || '';
  if (typeof accept === 'string' && accept.includes('text/html') && !req.headers['x-proxy-app-id'] && !req.headers['x-app-id']) {
    return res.redirect('/dashboard');
  }
  next();
});

// 5. Proxy Server Entrypoint: http://localhost:4000
//    ALL requests (e.g. Vite target: 'http://localhost:4000' forwarding /api/users, /api/todos, etc.)
//    pass through proxyMiddleware to the configured backend microservices.
app.use(proxyMiddleware);

// --- Initialization ---

export function initializeServer(): void {
  // Load config; migrate any legacy redirect URLs that still have pathPrefix but no port
  let apps: Application[] = configManager.getApplications();
  let migrated = false;
  apps = apps.map(appItem => {
    const updatedRedirects: RedirectUrl[] = (appItem.redirectUrls || []).map(red => {
      const targetUrl = red.targetUrl || (red as unknown as { url?: string }).url || '';
      if (!red.port) {
        migrated = true;
        return {
          id: red.id,
          name: red.name,
          targetUrl,
          port: configManager.assignRedirectPort(undefined, targetUrl, apps, appItem.id, red.id)
        };
      }
      return red;
    });
    return { ...appItem, redirectUrls: updatedRedirects };
  });

  if (migrated) {
    configManager.saveApplications(apps);
    console.log('  [Migration] Assigned ports to legacy redirect URL entries.');
  }

  // Share SSE clients array so redirect proxies broadcast to the same dashboard feed
  redirectProxyManager.setSseClients(sseClients);

  // Start dedicated proxy servers for all active redirect URLs
  redirectProxyManager.syncRedirectProxies(apps);
}

/**
 * Gracefully shuts down all active SSE connections, redirect proxy servers, and main HTTP server.
 */
export function gracefulShutdown(server?: import('http').Server, cb?: () => void): void {
  closeAllSseClients();
  redirectProxyManager.stopAllRedirectProxies();

  if (server && typeof server.close === 'function') {
    server.close(() => {
      if (cb) cb();
    });
  } else {
    if (cb) cb();
  }
}

// Only start listening if not in test environment and run directly
if (process.env.NODE_ENV !== 'test') {
  initializeServer();
  const serverInstance = app.listen(PORT, '0.0.0.0', () => {
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

  const handleSignal = () => {
    console.log('\n[Server] Shutting down gracefully...');
    gracefulShutdown(serverInstance, () => {
      console.log('[Server] Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}
