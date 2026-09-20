import fs from 'fs';
import path from 'path';
import uuidv4 from '../utils/uuid';
import * as settingsManager from './settingsManager';
import type { Application, BackendUrl, RedirectUrl, CreateApplicationInput, UpdateApplicationInput } from '../types';

// Main server port (defaults to 4000)
const MAIN_SERVER_PORT = parseInt(process.env['PORT'] || '4000', 10);
// First port used for redirect proxy servers
const BASE_REDIRECT_PORT = parseInt(process.env['REDIRECT_BASE_PORT'] || '4001', 10);

// Sample default configurations if empty
const DEFAULT_CONFIG: Application[] = [
  {
    id: 'app-default-1',
    name: 'Sample JSON Store API',
    frontEndUrl: 'http://localhost:3000',
    backendUrls: [
      {
        id: 'be-1',
        name: 'JSON Placeholder API',
        url: 'https://jsonplaceholder.typicode.com',
        pathPrefix: '/posts'
      }
    ],
    redirectUrls: [],
    isActive: true
  },
  {
    id: 'app-default-2',
    name: 'Sample SOAP Calculator Service',
    frontEndUrl: 'http://localhost:3001',
    backendUrls: [
      {
        id: 'be-2',
        name: 'Calculator SOAP Backend',
        url: 'http://www.dneonline.com',
        pathPrefix: '/calculator'
      }
    ],
    redirectUrls: [],
    isActive: true
  }
];

// Ensure directory exists
function ensureConfigDir(): void {
  const configDir = settingsManager.getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Normalizes a path prefix string to always start with '/' and end without trailing '/'
 * e.g., "api/users" -> "/api/users"
 */
export function normalizePathPrefix(prefix: string | undefined): string {
  if (!prefix) return '/';
  let str = prefix.trim();
  if (!str.startsWith('/')) {
    str = '/' + str;
  }
  if (str.length > 1 && str.endsWith('/')) {
    str = str.slice(0, -1);
  }
  return str;
}

/**
 * Normalizes a target URL for comparison (trims whitespace and trailing slashes, lowercases scheme/host).
 */
export function normalizeTargetUrl(url: string | undefined): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Returns the appropriate redirect proxy port for a given targetUrl.
 * 1. Reuse port if another redirect already targets the exact same URL.
 * 2. Keep existingPort if it doesn't collide with a different target.
 * 3. Otherwise, find the next available port from BASE_REDIRECT_PORT.
 */
export function assignRedirectPort(
  existingPort: number | undefined,
  targetUrl: string,
  allApps: Application[] = [],
  currentAppId: string | null = null,
  currentRedId: string | null = null
): number {
  const normTarget = normalizeTargetUrl(targetUrl);

  // 1. Check if any other redirection already uses a port for the exact same targetUrl
  if (normTarget) {
    for (const app of allApps) {
      for (const red of app.redirectUrls || []) {
        if (currentAppId && currentRedId && app.id === currentAppId && red.id === currentRedId) {
          continue;
        }
        if (red.port && normalizeTargetUrl(red.targetUrl) === normTarget) {
          return red.port;
        }
      }
    }
  }

  // 2. Collect all ports used by DIFFERENT targets (and the main server port)
  const portsUsedByOtherTargets = new Set<number>([MAIN_SERVER_PORT]);
  for (const app of allApps) {
    for (const red of app.redirectUrls || []) {
      if (currentAppId && currentRedId && app.id === currentAppId && red.id === currentRedId) {
        continue;
      }
      if (red.port) {
        const otherNorm = normalizeTargetUrl(red.targetUrl);
        if (!normTarget || otherNorm !== normTarget) {
          portsUsedByOtherTargets.add(red.port);
        }
      }
    }
  }

  // 3. Keep existingPort if it doesn't conflict with another target or the main port
  if (existingPort && !portsUsedByOtherTargets.has(existingPort)) {
    return existingPort;
  }

  // 4. Find next available port
  let port = BASE_REDIRECT_PORT;
  while (portsUsedByOtherTargets.has(port)) {
    port++;
  }
  return port;
}

export function getApplications(): Application[] {
  ensureConfigDir();
  const configFile = settingsManager.getConfigFile();
  if (!fs.existsSync(configFile)) {
    saveApplications(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const data = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(data) as Application[];
  } catch (err) {
    console.error('Error reading config file:', err);
    return [];
  }
}

export function saveApplications(applications: Application[]): void {
  ensureConfigDir();
  const configFile = settingsManager.getConfigFile();
  fs.writeFileSync(configFile, JSON.stringify(applications, null, 2), 'utf8');
}

export function getApplicationById(id: string): Application | undefined {
  const apps = getApplications();
  return apps.find(app => app.id === id);
}

export function createApplication(appData: CreateApplicationInput): Application {
  const apps = getApplications();
  const newApp: Application = {
    id: appData.id || uuidv4(),
    name: appData.name || 'New Application',
    frontEndUrl: appData.frontEndUrl || '',
    backendUrls: (appData.backendUrls || []).map((be: Partial<BackendUrl>) => ({
      id: be.id || uuidv4(),
      name: be.name || 'Backend Service',
      url: be.url || '',
      pathPrefix: normalizePathPrefix(be.pathPrefix)
    })),
    redirectUrls: [], // ports assigned below after push (so allApps is up to date)
    isActive: appData.isActive !== undefined ? appData.isActive : true
  };
  apps.push(newApp);

  // Assign ports now that newApp is in the array (avoids collisions with itself)
  newApp.redirectUrls = (appData.redirectUrls || []).map((red: Partial<RedirectUrl>) => {
    const redId = red.id || uuidv4();
    const targetUrl = red.targetUrl || '';
    return {
      id: redId,
      name: red.name || 'API Redirection',
      targetUrl,
      port: assignRedirectPort(red.port, targetUrl, apps, newApp.id, redId)
    };
  });

  saveApplications(apps);
  return newApp;
}

export function updateApplication(
  id: string,
  appData: UpdateApplicationInput
): Application | null {
  const apps = getApplications();
  const index = apps.findIndex(app => app.id === id);
  if (index === -1) return null;

  // Build updated redirect list — preserve existing ports where possible
  const existingRedirects = apps[index]?.redirectUrls || [];
  const updatedRedirects: RedirectUrl[] = (
    appData.redirectUrls || existingRedirects
  ).map((red: Partial<RedirectUrl>) => {
    const existing = existingRedirects.find(e => e.id === red.id);
    const redId = red.id || (existing && existing.id) || uuidv4();
    const targetUrl =
      red.targetUrl || (existing && existing.targetUrl) || '';
    const existingPort = red.port || (existing && existing.port);
    return {
      id: redId,
      name: red.name || 'API Redirection',
      targetUrl,
      port: assignRedirectPort(existingPort, targetUrl, apps, id, redId)
    };
  });

  apps[index] = {
    ...apps[index]!,
    ...appData,
    id, // preserve id
    backendUrls: (appData.backendUrls || apps[index]?.backendUrls || []).map(
      (be: Partial<BackendUrl>) => ({
        id: be.id || uuidv4(),
        name: be.name || 'Backend Service',
        url: be.url || '',
        pathPrefix: normalizePathPrefix(be.pathPrefix)
      })
    ),
    redirectUrls: updatedRedirects
  };

  saveApplications(apps);
  return apps[index]!;
}

export function deleteApplication(id: string): boolean {
  let apps = getApplications();
  const initialLength = apps.length;
  apps = apps.filter(app => app.id !== id);
  if (apps.length !== initialLength) {
    saveApplications(apps);
    return true;
  }
  return false;
}
