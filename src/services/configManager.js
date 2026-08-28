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

// First port used for redirect proxy servers (main proxy is BASE_PORT, typically 4000)
const BASE_REDIRECT_PORT = parseInt(process.env.REDIRECT_BASE_PORT || '4001', 10);

/**
 * Returns the next unused redirect proxy port by scanning all existing apps.
 * If this redirect already has a port assigned, returns it unchanged.
 * @param {string|undefined} existingPort - already-assigned port (preserved if set)
 * @param {Array} allApps - full current applications array
 * @returns {number}
 */
function assignRedirectPort(existingPort, allApps) {
  if (existingPort) return existingPort;
  const usedPorts = new Set();
  for (const app of allApps) {
    for (const red of (app.redirectUrls || [])) {
      if (red.port) usedPorts.add(red.port);
    }
  }
  let port = BASE_REDIRECT_PORT;
  while (usedPorts.has(port)) port++;
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
  newApp.redirectUrls = (appData.redirectUrls || []).map(red => ({
    id: red.id || uuidv4(),
    name: red.name || 'API Redirection',
    targetUrl: red.targetUrl || '',
    port: assignRedirectPort(red.port, apps)
  }));
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
    return {
      id: red.id || uuidv4(),
      name: red.name || 'API Redirection',
      targetUrl: red.targetUrl || '',
      port: assignRedirectPort(red.port || (existing && existing.port), apps)
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
  assignRedirectPort
};
