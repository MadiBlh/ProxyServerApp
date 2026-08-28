const fs = require('fs');
const path = require('path');
const uuidv4 = require('../utils/uuid');

const CONFIG_DIR = path.join(__dirname, '../../config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'applications.json');

// Ensure directory exists
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Normalizes a path prefix string to always start with '/' and end without trailing '/'
 * e.g., "api/users" -> "/api/users"
 */
function normalizePathPrefix(prefix) {
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
function normalizeTargetUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

// Main server port (defaults to 4000)
const MAIN_SERVER_PORT = parseInt(process.env.PORT || '4000', 10);
// First port used for redirect proxy servers
const BASE_REDIRECT_PORT = parseInt(process.env.REDIRECT_BASE_PORT || '4001', 10);

/**
 * Returns the appropriate redirect proxy port for a given targetUrl:
 * 1. If another redirection across any active/configured application already targets
 *    the exact same targetUrl and has a port assigned, reuse that port.
 * 2. If existingPort is provided, is not the main server port, and does not collide
 *    with a different targetUrl's assigned port, keep it.
 * 3. Otherwise, find the next available port starting from BASE_REDIRECT_PORT
 *    (avoiding MAIN_SERVER_PORT and ports used by different targets).
 *
 * @param {number|undefined} existingPort - current port assigned to this entry
 * @param {string} targetUrl - the destination external URL
 * @param {Array} allApps - full applications array
 * @param {string} [currentAppId] - id of app being created/updated
 * @param {string} [currentRedId] - id of redirection entry being created/updated
 * @returns {number}
 */
function assignRedirectPort(existingPort, targetUrl, allApps = [], currentAppId = null, currentRedId = null) {
  const normTarget = normalizeTargetUrl(targetUrl);

  // 1. Check if any other redirection already uses a port for the exact same targetUrl
  if (normTarget) {
    for (const app of allApps) {
      for (const red of (app.redirectUrls || [])) {
        if (currentAppId && currentRedId && app.id === currentAppId && red.id === currentRedId) {
          continue;
        }
        if (red.port && normalizeTargetUrl(red.targetUrl || red.url) === normTarget) {
          return red.port;
        }
      }
    }
  }

  // 2. Collect all ports used by DIFFERENT targets (and the main server port)
  const portsUsedByOtherTargets = new Set([MAIN_SERVER_PORT]);
  for (const app of allApps) {
    for (const red of (app.redirectUrls || [])) {
      if (currentAppId && currentRedId && app.id === currentAppId && red.id === currentRedId) {
        continue;
      }
      if (red.port) {
        const otherNorm = normalizeTargetUrl(red.targetUrl || red.url);
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

// Sample default configurations if empty
const DEFAULT_CONFIG = [
  {
    id: "app-default-1",
    name: "Sample JSON Store API",
    frontEndUrl: "http://localhost:3000",
    backendUrls: [
      {
        id: "be-1",
        name: "JSON Placeholder API",
        url: "https://jsonplaceholder.typicode.com",
        pathPrefix: "/posts"
      }
    ],
    isActive: true
  },
  {
    id: "app-default-2",
    name: "Sample SOAP Calculator Service",
    frontEndUrl: "http://localhost:3001",
    backendUrls: [
      {
        id: "be-2",
        name: "Calculator SOAP Backend",
        url: "http://www.dneonline.com",
        pathPrefix: "/calculator"
      }
    ],
    isActive: true
  }
];

function getApplications() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    saveApplications(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading config file:', err);
    return [];
  }
}

function saveApplications(applications) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(applications, null, 2), 'utf8');
}

function getApplicationById(id) {
  const apps = getApplications();
  return apps.find(app => app.id === id);
}

function createApplication(appData) {
  const apps = getApplications();
  const newApp = {
    id: appData.id || uuidv4(),
    name: appData.name || 'New Application',
    frontEndUrl: appData.frontEndUrl || '',
    backendUrls: (appData.backendUrls || []).map(be => ({
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
  newApp.redirectUrls = (appData.redirectUrls || []).map(red => {
    const redId = red.id || uuidv4();
    const targetUrl = red.targetUrl || red.url || '';
    return {
      id: redId,
      name: red.name || 'API Redirection',
      targetUrl: targetUrl,
      port: assignRedirectPort(red.port, targetUrl, apps, newApp.id, redId)
    };
  });
  saveApplications(apps);
  return newApp;
}

function updateApplication(id, appData) {
  const apps = getApplications();
  const index = apps.findIndex(app => app.id === id);
  if (index === -1) return null;

  // Build updated redirect list — preserve existing ports where possible
  const existingRedirects = apps[index].redirectUrls || [];
  const updatedRedirects = (appData.redirectUrls || existingRedirects).map(red => {
    const existing = existingRedirects.find(e => e.id === red.id);
    const redId = red.id || (existing && existing.id) || uuidv4();
    const targetUrl = red.targetUrl || red.url || (existing && (existing.targetUrl || existing.url)) || '';
    const existingPort = red.port || (existing && existing.port);
    return {
      id: redId,
      name: red.name || 'API Redirection',
      targetUrl: targetUrl,
      port: assignRedirectPort(existingPort, targetUrl, apps, id, redId)
    };
  });

  apps[index] = {
    ...apps[index],
    ...appData,
    id, // preserve id
    backendUrls: (appData.backendUrls || apps[index].backendUrls || []).map(be => ({
      id: be.id || uuidv4(),
      name: be.name || 'Backend Service',
      url: be.url || '',
      pathPrefix: normalizePathPrefix(be.pathPrefix)
    })),
    redirectUrls: updatedRedirects
  };
  saveApplications(apps);
  return apps[index];
}

function deleteApplication(id) {
  let apps = getApplications();
  const initialLength = apps.length;
  apps = apps.filter(app => app.id !== id);
  if (apps.length !== initialLength) {
    saveApplications(apps);
    return true;
  }
  return false;
}

module.exports = {
  getApplications,
  getApplicationById,
  saveApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  normalizePathPrefix,
  normalizeTargetUrl,
  assignRedirectPort
};
