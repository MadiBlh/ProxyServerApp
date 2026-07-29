const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CONFIG_DIR = path.join(__dirname, '../../config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'applications.json');

// Ensure directory exists
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
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
        url: "https://jsonplaceholder.typicode.com"
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
        url: "http://www.dneonline.com"
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
      url: be.url || ''
    })),
    isActive: appData.isActive !== undefined ? appData.isActive : true
  };
  apps.push(newApp);
  saveApplications(apps);
  return newApp;
}

function updateApplication(id, appData) {
  const apps = getApplications();
  const index = apps.findIndex(app => app.id === id);
  if (index === -1) return null;

  apps[index] = {
    ...apps[index],
    ...appData,
    id, // preserve id
    backendUrls: (appData.backendUrls || apps[index].backendUrls || []).map(be => ({
      id: be.id || uuidv4(),
      name: be.name || 'Backend Service',
      url: be.url || ''
    }))
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
  deleteApplication
};
