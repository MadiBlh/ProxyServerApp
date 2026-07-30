/* ==========================================================================
   PROXY SERVER LOG - MAIN FRONTEND APPLICATION CONTROLLER
   ========================================================================== */

// --- Module-level state (accessible by all functions) ---
let applications = [];
let currentAppId = localStorage.getItem('proxy_selected_app_id') || null;
let logsList = [];
let selectedLogId = null;
let selectedLogDetail = null;
let currentTheme = localStorage.getItem('proxy_theme') || 'dark';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Theme
  applyTheme(currentTheme);

  // Initialize Monaco Editors
  try {
    await window.monacoManager.initMonacoEditors(currentTheme);
  } catch (err) {
    console.error('Failed to load Monaco Editor from CDN:', err);
  }

  // Load Initial Applications
  await loadApplications();

  // Connect SSE for Real-time Logs Feed
  initSseFeed();

  // Attach Event Listeners
  attachEventListeners();
});

// --- Theme Management ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('proxy_theme', theme);
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
  }
  if (window.monacoManager) {
    window.monacoManager.setMonacoTheme(theme);
  }
}

// --- Applications API Management ---
async function loadApplications() {
  try {
    const res = await fetch('/dashboard-api/applications');
    applications = await res.json();

    const dropdown = document.getElementById('app-dropdown');
    dropdown.innerHTML = '';

    if (applications.length === 0) {
      dropdown.innerHTML = '<option value="">No apps configured</option>';
      currentAppId = null;
      renderLogs([]);
      return;
    }

    applications.forEach(app => {
      const opt = document.createElement('option');
      opt.value = app.id;
      opt.textContent = `${app.name} ${app.isActive ? '' : '(Inactive)'}`;
      dropdown.appendChild(opt);
    });

    // Restore selected app or choose first
    if (currentAppId && applications.some(a => a.id === currentAppId)) {
      dropdown.value = currentAppId;
    } else {
      currentAppId = applications[0].id;
      dropdown.value = currentAppId;
    }

    localStorage.setItem('proxy_selected_app_id', currentAppId);

    // Load logs for current app
    await loadLogsForApp(currentAppId);

  } catch (err) {
    showToast('Failed to load web applications', 'error');
  }
}

// --- Logs Management ---
async function loadLogsForApp(appId) {
  try {
    const res = await fetch(`/dashboard-api/logs?appId=${appId}`);
    logsList = await res.json();
    renderLogs(logsList);

    if (logsList.length > 0) {
      selectLog(logsList[0].id);
    } else {
      clearLogDetailsView();
    }
  } catch (err) {
    showToast('Failed to load logs', 'error');
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logs-list-container');
  container.innerHTML = '';

  const filterText = (document.getElementById('search-input')?.value || '').toLowerCase();

  const filteredLogs = logs.filter(log => {
    const endpoint = (log.endpoint || '').toLowerCase();
    const method = (log.method || '').toLowerCase();
    return endpoint.includes(filterText) || method.includes(filterText);
  });

  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📡</div>
        <p>No logged requests found</p>
      </div>
    `;
    return;
  }

  filteredLogs.forEach(log => {
    const li = document.createElement('li');
    li.className = `log-item ${log.id === selectedLogId ? 'active' : ''}`;
    li.onclick = () => selectLog(log.id);

    const isOk = log.status === 'OK' || (log.statusCode >= 200 && log.statusCode < 400);
    const dotClass = isOk ? 'green' : 'red';

    const formattedTime = new Date(log.timestamp).toLocaleTimeString();

    li.innerHTML = `
      <div class="status-dot ${dotClass}" title="Status: ${log.statusCode || 'FAILED'}"></div>
      <div class="log-info">
        <div class="log-endpoint" title="${escapeHtml(log.endpoint)}">${escapeHtml(log.endpoint)}</div>
        <div class="log-meta">
          <span class="method-badge method-${log.method}">${log.method}</span>
          <span>${log.statusCode || 'ERR'}</span>
          <span>•</span>
          <span>${formattedTime}</span>
          <span>•</span>
          <span>${log.durationMs}ms</span>
        </div>
      </div>
    `;
    container.appendChild(li);
  });
}

async function selectLog(logId) {
  selectedLogId = logId;

  // Highlight active list item
  const items = document.querySelectorAll('.log-item');
  items.forEach(item => item.classList.remove('active'));

  // Re-render list to ensure selection state matches
  renderLogs(logsList);

  try {
    const res = await fetch(`/dashboard-api/logs/${logId}`);
    selectedLogDetail = await res.json();
    renderLogDetail(selectedLogDetail);
  } catch (err) {
    showToast('Failed to load log detail', 'error');
  }
}

function renderLogDetail(detail) {
  const { reqMeta, resMeta, requestBody, responseBody } = detail;

  // Request Section Header
  document.getElementById('req-method-badge').className = `method-badge method-${reqMeta.method}`;
  document.getElementById('req-method-badge').textContent = reqMeta.method;
  document.getElementById('req-url-text').textContent = reqMeta.targetUrl + (reqMeta.endpoint || '');

  // Response Section Header
  const statusCode = resMeta.statusCode || 500;
  const isOk = resMeta.statusText === 'OK' || (statusCode >= 200 && statusCode < 400);
  const statusBadge = document.getElementById('res-status-badge');
  statusBadge.textContent = `${statusCode} ${resMeta.statusText || ''}`;
  statusBadge.className = `btn ${isOk ? 'btn-primary' : 'btn-danger'}`;
  document.getElementById('res-duration-text').textContent = `${resMeta.durationMs || 0} ms`;

  // Render Headers
  renderHeadersView('request-headers-view', reqMeta.headers || {});
  renderHeadersView('response-headers-view', resMeta.headers || {});

  // Render Monaco Editor Content
  window.monacoManager.setRequestBodyContent(requestBody, reqMeta.fileExtension);
  window.monacoManager.setResponseBodyContent(responseBody, resMeta.fileExtension);
}

function renderHeadersView(containerId, headersObj) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const keys = Object.keys(headersObj);
  if (keys.length === 0) {
    container.innerHTML = '<div class="text-muted">No headers</div>';
    return;
  }

  keys.forEach(key => {
    const row = document.createElement('div');
    row.className = 'header-row';
    row.innerHTML = `
      <span class="header-key">${escapeHtml(key)}:</span>
      <span class="header-val">${escapeHtml(String(headersObj[key]))}</span>
    `;
    container.appendChild(row);
  });
}

function clearLogDetailsView() {
  selectedLogId = null;
  selectedLogDetail = null;
  document.getElementById('req-url-text').textContent = '-';
  document.getElementById('res-status-badge').textContent = '-';
  document.getElementById('res-duration-text').textContent = '-';
  document.getElementById('request-headers-view').innerHTML = '';
  document.getElementById('response-headers-view').innerHTML = '';
  window.monacoManager.setRequestBodyContent('');
  window.monacoManager.setResponseBodyContent('');
}

// --- SSE Realtime Feed ---
function initSseFeed() {
  const evtSource = new EventSource('/dashboard-api/events');
  evtSource.onmessage = (event) => {
    try {
      const logSummary = JSON.parse(event.data);
      if (logSummary.appId === currentAppId) {
        logsList.unshift(logSummary);
        renderLogs(logsList);
        // Auto select newly arrived log if none selected
        if (!selectedLogId) {
          selectLog(logSummary.id);
        }
      }
    } catch (e) {
      console.error('Error handling SSE event:', e);
    }
  };
}

// --- Event Listeners ---
function attachEventListeners() {
  // Theme toggle
  document.getElementById('theme-toggle-btn').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
  };

  // App Selector Change
  document.getElementById('app-dropdown').onchange = (e) => {
    currentAppId = e.target.value;
    localStorage.setItem('proxy_selected_app_id', currentAppId);
    loadLogsForApp(currentAppId);
  };

  // Search Filter
  document.getElementById('search-input').oninput = () => {
    renderLogs(logsList);
  };

  // Reload Logs Button
  document.getElementById('reload-logs-btn').onclick = () => {
    loadLogsForApp(currentAppId);
    showToast('Logs reloaded', 'success');
  };

  // Clear All Logs Button
  document.getElementById('remove-logs-btn').onclick = async () => {
    if (confirm('Are you sure you want to remove all log files from the server?')) {
      try {
        await fetch('/dashboard-api/logs', { method: 'DELETE' });
        logsList = [];
        renderLogs([]);
        clearLogDetailsView();
        showToast('All logs cleared successfully', 'success');
      } catch (err) {
        showToast('Failed to clear logs', 'error');
      }
    }
  };

  // Export Request Button
  document.getElementById('export-req-btn').onclick = () => {
    if (!selectedLogId) {
      showToast('Please select a request log to export', 'error');
      return;
    }
    document.getElementById('export-filename-input').value = `export_${selectedLogId.substring(0, 8)}`;
    openModal('export-modal');
  };

  document.getElementById('confirm-export-btn').onclick = async () => {
    const fileName = document.getElementById('export-filename-input').value.trim();
    if (!fileName) {
      alert('Please enter a valid file name prefix');
      return;
    }

    try {
      const res = await fetch(`/dashboard-api/logs/${selectedLogId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Saved files: ${data.files.requestFile} & ${data.files.responseFile}`, 'success');
        closeModal('export-modal');
      } else {
        showToast(data.error || 'Export failed', 'error');
      }
    } catch (err) {
      showToast('Export error', 'error');
    }
  };

  // Replay Request Button
  document.getElementById('replay-req-btn').onclick = () => {
    if (!selectedLogDetail) {
      showToast('Please select a request log to replay', 'error');
      return;
    }
    const { reqMeta, requestBody } = selectedLogDetail;
    document.getElementById('replay-url-input').value = reqMeta.targetUrl + (reqMeta.endpoint || '');
    document.getElementById('replay-method-select').value = reqMeta.method;
    document.getElementById('replay-headers-input').value = JSON.stringify(reqMeta.headers || {}, null, 2);
    document.getElementById('replay-body-input').value = requestBody || '';
    document.getElementById('replay-response-output').textContent = '// Click Send Replay to execute';
    openModal('replay-modal');
  };

  document.getElementById('execute-replay-btn').onclick = async () => {
    const url = document.getElementById('replay-url-input').value.trim();
    const method = document.getElementById('replay-method-select').value;
    let headers = {};
    try {
      headers = JSON.parse(document.getElementById('replay-headers-input').value || '{}');
    } catch (e) {
      alert('Invalid JSON in headers field');
      return;
    }
    const body = document.getElementById('replay-body-input').value;

    const out = document.getElementById('replay-response-output');
    out.textContent = 'Executing replay request...';

    try {
      const res = await fetch(`/dashboard-api/logs/${selectedLogId}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customUrl: url,
          customMethod: method,
          customHeaders: headers,
          customBody: body
        })
      });
      const data = await res.json();
      out.textContent = `STATUS: ${data.statusCode} ${data.statusText || ''} (${data.durationMs}ms)\n\nRESPONSE HEADERS:\n${JSON.stringify(data.headers, null, 2)}\n\nRESPONSE BODY:\n${data.body}`;
      showToast('Replay executed', data.success ? 'success' : 'error');
    } catch (err) {
      out.textContent = `Replay Error: ${err.message}`;
      showToast('Replay execution failed', 'error');
    }
  };

  // Manage / Settings Modal (Web Applications Manager)
  document.getElementById('manage-apps-btn').onclick = () => openAppManagerModal();

  // Tab View Switchers (Body vs Headers)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
      const targetTab = e.target.dataset.tab;
      const parentPane = e.target.closest('.detail-pane');

      parentPane.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      if (targetTab === 'body') {
        parentPane.querySelector('.monaco-container').style.display = 'block';
        parentPane.querySelector('.headers-view').style.display = 'none';
      } else {
        parentPane.querySelector('.monaco-container').style.display = 'none';
        parentPane.querySelector('.headers-view').style.display = 'block';
      }
    };
  });
}

// --- App Manager Modal Logic ---
function openAppManagerModal() {
  renderAppManagerList();
  openModal('app-manager-modal');
}

function renderAppManagerList() {
  const container = document.getElementById('app-manager-list');
  container.innerHTML = '';

  if (applications.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No applications configured yet.</p>';
    return;
  }

  applications.forEach(app => {
    const item = document.createElement('div');
    item.className = 'form-group';
    item.style.padding = '12px';
    item.style.border = '1px solid var(--border-color)';
    item.style.borderRadius = '8px';
    item.style.marginBottom = '10px';

    const backends = (app.backendUrls || []);
    const beLines = backends.map(b => {
      const prefix = b.pathPrefix ? ` [prefix: ${escapeHtml(b.pathPrefix)}]` : ' [default]';
      return `<li style="font-size:0.78rem; color:var(--text-muted);"><code style="color:var(--accent-color);">${escapeHtml(b.name)}</code> → ${escapeHtml(b.url)}${prefix}</li>`;
    }).join('');

    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 12px;">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <strong style="font-size:0.95rem;">${escapeHtml(app.name)}</strong>
            ${app.isActive
              ? '<span style="color:var(--success-color); font-size:0.78rem; font-weight:600;">● Active</span>'
              : '<span style="color:var(--error-color); font-size:0.78rem; font-weight:600;">● Inactive</span>'}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">Frontend: <code>${escapeHtml(app.frontEndUrl)}</code></div>
          <ul style="margin: 0 0 0 4px; padding: 0; list-style: none;">${beLines || '<li style="color:var(--text-muted); font-size:0.78rem;">No backends configured</li>'}</ul>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="btn btn-primary" style="padding:5px 12px;" onclick="editApp('${app.id}')">Edit</button>
          <button class="btn btn-danger" style="padding:5px 12px;" onclick="deleteApp('${app.id}')">Delete</button>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

window.editApp = (id) => {
  const app = applications.find(a => a.id === id);
  if (!app) return;
  document.getElementById('edit-app-id').value = app.id;
  document.getElementById('edit-app-name').value = app.name;
  document.getElementById('edit-app-frontend').value = app.frontEndUrl;
  document.getElementById('edit-app-active').checked = app.isActive;

  // Populate backend services list
  const list = document.getElementById('backend-services-list');
  list.innerHTML = '';
  const backends = app.backendUrls && app.backendUrls.length > 0 ? app.backendUrls : [{ name: 'Main Backend', url: '', pathPrefix: '' }];
  backends.forEach(be => addBackendRow(be));

  openModal('edit-app-modal');
};

window.deleteApp = async (id) => {
  if (confirm('Delete this web application config?')) {
    try {
      await fetch(`/dashboard-api/applications/${id}`, { method: 'DELETE' });
      await loadApplications();
      renderAppManagerList();
      showToast('Application deleted', 'success');
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  }
};

document.getElementById('add-new-app-btn').onclick = () => {
  document.getElementById('edit-app-id').value = '';
  document.getElementById('edit-app-name').value = 'New Web Application';
  document.getElementById('edit-app-frontend').value = 'http://localhost:3000';
  document.getElementById('edit-app-active').checked = true;

  // Start with one default backend row
  const list = document.getElementById('backend-services-list');
  list.innerHTML = '';
  addBackendRow({ name: 'Main Backend', url: '', pathPrefix: '' });

  openModal('edit-app-modal');
};

document.getElementById('save-app-config-btn').onclick = async () => {
  const id = document.getElementById('edit-app-id').value;
  const name = document.getElementById('edit-app-name').value.trim();
  const frontEndUrl = document.getElementById('edit-app-frontend').value.trim();
  const isActive = document.getElementById('edit-app-active').checked;

  const backendUrls = readBackendRows();

  if (backendUrls.length === 0) {
    showToast('Please add at least one backend service', 'error');
    return;
  }

  const hasInvalidUrl = backendUrls.some(be => !be.url.trim());
  if (hasInvalidUrl) {
    showToast('All backend services must have a valid URL', 'error');
    return;
  }

  const hasInvalidPrefix = backendUrls.some(be => !be.pathPrefix || be.pathPrefix === '/');
  if (hasInvalidPrefix) {
    showToast('Path Prefix is required for every backend service (e.g. /api, /auth)', 'error');
    return;
  }

  const payload = { name, frontEndUrl, backendUrls, isActive };

  try {
    if (id) {
      await fetch(`/dashboard-api/applications/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      await fetch('/dashboard-api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    closeModal('edit-app-modal');
    await loadApplications();
    renderAppManagerList();
    showToast('Application configuration saved', 'success');
  } catch (err) {
    showToast('Failed to save application config', 'error');
  }
};

// --- Add-Backend button inside edit modal ---
document.getElementById('add-backend-btn').onclick = () => {
  addBackendRow({ name: '', url: '', pathPrefix: '/api' });
};

/**
 * Renders one backend service row inside the backend-services-list container.
 * @param {{ name: string, url: string, pathPrefix?: string }} be
 */
function addBackendRow(be = { name: '', url: '', pathPrefix: '/api' }) {
  const list = document.getElementById('backend-services-list');
  const idx = list.children.length;

  const row = document.createElement('div');
  row.className = 'backend-row';
  row.dataset.backendIdx = idx;

  const isDefault = idx === 0;

  row.innerHTML = `
    <div class="backend-row-header">
      <span class="backend-row-title">Backend #${idx + 1}</span>
      <div style="display:flex; align-items:center; gap:8px;">
        ${isDefault ? '<span class="backend-row-default-badge">Primary</span>' : ''}
        <button type="button" class="backend-row-remove">Remove</button>
      </div>
    </div>
    <div class="backend-row-fields">
      <div class="form-group">
        <label class="form-label">Service Name:</label>
        <input type="text" class="form-control be-name" placeholder="e.g. Auth API" value="${escapeHtml(be.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Target URL:</label>
        <input type="text" class="form-control be-url" placeholder="http://localhost:5000" value="${escapeHtml(be.url)}">
      </div>
      <div class="form-group">
        <label class="form-label" style="color:var(--accent-color); font-weight:700;">Path Prefix *:</label>
        <input type="text" class="form-control be-prefix" placeholder="e.g. /api" value="${escapeHtml(be.pathPrefix || '')}">
      </div>
    </div>
  `;

  row.querySelector('.backend-row-remove').onclick = () => {
    row.remove();
    reindexBackendRows();
  };

  list.appendChild(row);
}

/**
 * Re-index all backend rows after removal.
 */
function reindexBackendRows() {
  const list = document.getElementById('backend-services-list');
  Array.from(list.children).forEach((row, i) => {
    row.querySelector('.backend-row-title').textContent = `Backend #${i + 1}`;
    const existingBadge = row.querySelector('.backend-row-default-badge');
    if (i === 0 && !existingBadge) {
      const header = row.querySelector('.backend-row-header > div');
      const badge = document.createElement('span');
      badge.className = 'backend-row-default-badge';
      badge.textContent = 'Primary';
      header.insertBefore(badge, header.querySelector('.backend-row-remove'));
    } else if (i !== 0 && existingBadge) {
      existingBadge.remove();
    }
  });
}

/**
 * Reads all backend rows from the list and returns an array of backend objects with normalized pathPrefix.
 * @returns {{ name: string, url: string, pathPrefix: string }[]}
 */
function readBackendRows() {
  const list = document.getElementById('backend-services-list');
  return Array.from(list.children).map(row => {
    let prefix = row.querySelector('.be-prefix').value.trim();
    if (prefix && !prefix.startsWith('/')) {
      prefix = '/' + prefix;
    }
    if (prefix.length > 1 && prefix.endsWith('/')) {
      prefix = prefix.slice(0, -1);
    }
    return {
      name: row.querySelector('.be-name').value.trim(),
      url: row.querySelector('.be-url').value.trim(),
      pathPrefix: prefix
    };
  });
}

// --- Modal Helpers ---
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

window.closeModal = closeModal;

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
