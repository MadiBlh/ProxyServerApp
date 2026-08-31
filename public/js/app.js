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
      document.getElementById('remove-logs-btn').disabled = true;
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

        document.getElementById('remove-logs-btn').disabled = false;
        localStorage.setItem('proxy_selected_app_id', currentAppId);
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
    const isRedirect = log.routeType === 'redirect';
    const badgeStyle = isRedirect
      ? 'background:rgba(234, 179, 8, 0.15); color:#eab308; border: 1px solid rgba(234, 179, 8, 0.3);'
      : 'background:var(--accent-light); color:var(--accent-color);';

    const backendPill = log.backendName
      ? `<span style="font-size:0.68rem; padding:1px 6px; border-radius:4px; ${badgeStyle} font-weight:600;">${isRedirect ? '🔀 ' : ''}${escapeHtml(log.backendName)}</span>`
      : '';

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
          ${backendPill}
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

  if (!headersObj || typeof headersObj !== 'object') {
    container.innerHTML = '<div class="text-muted" style="padding:12px;">No headers available</div>';
    return;
  }

  const keys = Object.keys(headersObj);
  if (keys.length === 0) {
    container.innerHTML = '<div class="text-muted" style="padding:12px;">No headers available</div>';
    return;
  }

  keys.forEach(key => {
    const val = headersObj[key];
    const lowerKey = key.toLowerCase();
    const isCookieHeader = lowerKey === 'cookie' || lowerKey === 'set-cookie';

    if (Array.isArray(val)) {
      val.forEach(item => {
        const row = document.createElement('div');
        row.className = 'header-row';
        if (isCookieHeader) row.style.background = 'rgba(234, 179, 8, 0.08)';

        row.innerHTML = `
          <span class="header-key" style="${isCookieHeader ? 'color: #eab308; font-weight:700;' : ''}">
            ${isCookieHeader ? '🍪 ' : ''}${escapeHtml(key)}:
          </span>
          <span class="header-val" style="word-break: break-all;">${escapeHtml(String(item))}</span>
        `;
        container.appendChild(row);
      });
    } else if (lowerKey === 'cookie' && typeof val === 'string' && val.includes(';')) {
      const cookieItems = val.split(';');
      cookieItems.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'header-row';
        row.style.background = 'rgba(234, 179, 8, 0.08)';
        row.innerHTML = `
          <span class="header-key" style="color: #eab308; font-weight:700;">
            🍪 Cookie${cookieItems.length > 1 ? ` #${idx + 1}` : ''}:
          </span>
          <span class="header-val" style="word-break: break-all;">${escapeHtml(item.trim())}</span>
        `;
        container.appendChild(row);
      });
    } else {
      const row = document.createElement('div');
      row.className = 'header-row';
      if (isCookieHeader) row.style.background = 'rgba(234, 179, 8, 0.08)';

      row.innerHTML = `
        <span class="header-key" style="${isCookieHeader ? 'color: #eab308; font-weight:700;' : ''}">
          ${isCookieHeader ? '🍪 ' : ''}${escapeHtml(key)}:
        </span>
        <span class="header-val" style="word-break: break-all;">${escapeHtml(String(val))}</span>
      `;
      container.appendChild(row);
    }
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
    document.getElementById('remove-logs-btn').disabled = !currentAppId;
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
    if (!currentAppId) {
      showToast('Select an application first', 'error');
      return;
    }
    if (confirm('Remove all logs for the selected application?')) {
      try {
        await fetch('/dashboard-api/logs', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: currentAppId })
        });
        logsList = [];
        renderLogs([]);
        clearLogDetailsView();
        showToast('Logs cleared for selected application', 'success');
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
        showToast(`Saved to Downloads: ${data.files.requestFile} & ${data.files.responseFile}`, 'success');
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

  // Manage / Settings Modal
  const settingsBtn = document.getElementById('settings-btn') || document.getElementById('manage-apps-btn');
  if (settingsBtn) {
    settingsBtn.onclick = () => openSettingsModal();
  }

  // Settings Tabs Switcher
  const tabApps = document.getElementById('tab-settings-apps');
  const tabPaths = document.getElementById('tab-settings-paths');
  const secApps = document.getElementById('settings-section-apps');
  const secPaths = document.getElementById('settings-section-paths');

  if (tabApps && tabPaths && secApps && secPaths) {
    tabApps.onclick = () => switchSettingsTab('apps');
    tabPaths.onclick = () => switchSettingsTab('paths');
  }

  function switchSettingsTab(tab) {
    if (tab === 'apps') {
      tabApps.classList.add('active');
      tabApps.style.color = 'var(--accent-color)';
      tabApps.style.borderBottomColor = 'var(--accent-color)';
      tabPaths.classList.remove('active');
      tabPaths.style.color = 'var(--text-secondary)';
      tabPaths.style.borderBottomColor = 'transparent';
      secApps.style.display = 'block';
      secPaths.style.display = 'none';
    } else {
      tabPaths.classList.add('active');
      tabPaths.style.color = 'var(--accent-color)';
      tabPaths.style.borderBottomColor = 'var(--accent-color)';
      tabApps.classList.remove('active');
      tabApps.style.color = 'var(--text-secondary)';
      tabApps.style.borderBottomColor = 'transparent';
      secApps.style.display = 'none';
      secPaths.style.display = 'block';
      loadStorageSettings();
    }
  }

  // Reset to Default button handlers
  const resetConfigBtn = document.getElementById('reset-config-path-btn');
  if (resetConfigBtn) {
    resetConfigBtn.onclick = () => {
      const input = document.getElementById('setting-config-dir');
      if (input) input.value = '';
    };
  }

  const resetLogsBtn = document.getElementById('reset-logs-path-btn');
  if (resetLogsBtn) {
    resetLogsBtn.onclick = () => {
      const input = document.getElementById('setting-logs-dir');
      if (input) input.value = '';
    };
  }

  // Save Storage Settings
  const saveStorageBtn = document.getElementById('save-storage-settings-btn');
  if (saveStorageBtn) {
    saveStorageBtn.onclick = async () => {
      const configDir = document.getElementById('setting-config-dir').value.trim();
      const logsDir = document.getElementById('setting-logs-dir').value.trim();
      const migrateExistingConfig = document.getElementById('setting-migrate-config').checked;

      try {
        saveStorageBtn.disabled = true;
        saveStorageBtn.textContent = 'Saving...';

        const res = await fetch('/dashboard-api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ configDir, logsDir, migrateExistingConfig })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update storage paths');

        showToast('Storage paths updated successfully', 'success');
        await loadStorageSettings();
        await loadApplications();
        renderAppManagerList();
        loadLogsList();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        saveStorageBtn.disabled = false;
        saveStorageBtn.textContent = '💾 Save Storage Settings';
      }
    };
  }

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
        if (window.monacoManager && window.monacoManager.layoutEditors) {
          window.monacoManager.layoutEditors();
        }
      } else {
        parentPane.querySelector('.monaco-container').style.display = 'none';
        parentPane.querySelector('.headers-view').style.display = 'block';
      }
    };
  });

  // Collapse / Expand Request Panel
  const reqPane = document.getElementById('request-pane');
  const toggleReqBtn = document.getElementById('toggle-request-pane-btn');
  if (toggleReqBtn && reqPane) {
    toggleReqBtn.onclick = (e) => {
      e.stopPropagation();
      togglePane(reqPane, toggleReqBtn);
    };
  }

  // Collapse / Expand Response Panel
  const resPane = document.getElementById('response-pane');
  const toggleResBtn = document.getElementById('toggle-response-pane-btn');
  if (toggleResBtn && resPane) {
    toggleResBtn.onclick = (e) => {
      e.stopPropagation();
      togglePane(resPane, toggleResBtn);
    };
  }

  // Collapse / Expand Sidebar
  const sidebar = document.getElementById('log-sidebar');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.onclick = (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('collapsed');
      const icon = toggleSidebarBtn.querySelector('.collapse-icon');
      if (sidebar.classList.contains('collapsed')) {
        if (icon) icon.textContent = '▶';
      } else {
        if (icon) icon.textContent = '◀';
      }
    };
  }

  function togglePane(pane, btn) {
    const isCollapsed = pane.classList.toggle('collapsed');
    const icon = btn.querySelector('.collapse-icon');
    const text = btn.querySelector('.collapse-text');

    if (isCollapsed) {
      if (icon) icon.textContent = '▼';
      if (text) text.textContent = 'Expand';
    } else {
      if (icon) icon.textContent = '▲';
      if (text) text.textContent = 'Collapse';
    }

    setTimeout(() => {
      if (window.monacoManager && window.monacoManager.layoutEditors) {
        window.monacoManager.layoutEditors();
      }
    }, 260);
  }
}

// --- Settings Modal & Storage Settings Logic ---
async function loadStorageSettings() {
  try {
    const res = await fetch('/dashboard-api/settings');
    const data = await res.json();

    const configInput = document.getElementById('setting-config-dir');
    const logsInput = document.getElementById('setting-logs-dir');

    if (configInput) {
      configInput.value = data.isDefaultConfig ? '' : data.configDir;
      configInput.placeholder = `Default: ${data.defaults?.configDir || 'config/'}`;
    }

    if (logsInput) {
      logsInput.value = data.isDefaultLogs ? '' : data.logsBaseDir;
      logsInput.placeholder = `Default: ${data.defaults?.logsBaseDir || 'project root'}`;
    }
  } catch (err) {
    console.error('Failed to load storage settings:', err);
  }
}

function openSettingsModal() {
  renderAppManagerList();
  loadStorageSettings();
  const tabApps = document.getElementById('tab-settings-apps');
  if (tabApps) tabApps.click();
  openModal('settings-modal');
}

function openAppManagerModal() {
  openSettingsModal();
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

    const redirects = (app.redirectUrls || []);
    const redLines = redirects.map(r => {
      const portText = r.port ? `http://localhost:${r.port}` : 'auto-assigned on save';
      return `<li style="font-size:0.78rem; color:var(--text-muted);"><span style="color:#eab308;">🔀 ${escapeHtml(r.name)}</span> → <code style="color:var(--accent-color);">${portText}</code> → ${escapeHtml(r.targetUrl)}</li>`;
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
          <div style="font-size:0.78rem; font-weight:600; color:var(--text-color); margin-top:6px;">Backend Services:</div>
          <ul style="margin: 2px 0 6px 4px; padding: 0; list-style: none;">${beLines || '<li style="color:var(--text-muted); font-size:0.78rem;">No backends configured</li>'}</ul>
          ${redirects.length > 0 ? `
            <div style="font-size:0.78rem; font-weight:600; color:#eab308; margin-top:4px;">External APIs:</div>
            <ul style="margin: 2px 0 0 4px; padding: 0; list-style: none;">${redLines}</ul>
          ` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
          <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--text-color); cursor:pointer;" title="Listen and proxy requests for this application">
            <input type="checkbox" ${app.isActive ? 'checked' : ''} onchange="setAppActive('${app.id}', this.checked)" style="cursor:pointer;">
            Active
          </label>
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
  const beList = document.getElementById('backend-services-list');
  beList.innerHTML = '';
  const backends = app.backendUrls && app.backendUrls.length > 0 ? app.backendUrls : [{ name: 'Main Backend', url: '', pathPrefix: '/api' }];
  backends.forEach(be => addBackendRow(be));

  // Populate API redirections list
  const redList = document.getElementById('redirect-services-list');
  redList.innerHTML = '';
  const redirects = app.redirectUrls || [];
  redirects.forEach(red => addRedirectRow(red));

  openModal('edit-app-modal');
};

window.setAppActive = async (id, isActive) => {
  try {
    const res = await fetch(`/dashboard-api/applications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
    await loadApplications();
    renderAppManagerList();
    if (currentAppId === id) loadLogsForApp(id);
    showToast(`${isActive ? 'Activated' : 'Deactivated'} application`, isActive ? 'success' : 'info');
  } catch (err) {
    showToast(err.message, 'error');
    renderAppManagerList();
  }
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
  const beList = document.getElementById('backend-services-list');
  beList.innerHTML = '';
  addBackendRow({ name: 'Main Backend', url: '', pathPrefix: '/api' });

  // Clear redirections
  const redList = document.getElementById('redirect-services-list');
  redList.innerHTML = '';

  openModal('edit-app-modal');
};

document.getElementById('save-app-config-btn').onclick = async () => {
  const id = document.getElementById('edit-app-id').value;
  const name = document.getElementById('edit-app-name').value.trim();
  const frontEndUrl = document.getElementById('edit-app-frontend').value.trim();
  const isActive = document.getElementById('edit-app-active').checked;

  const backendUrls = readBackendRows();
  const redirectUrls = readRedirectRows();

  if (backendUrls.length === 0) {
    showToast('Please add at least one backend service', 'error');
    return;
  }

  const hasInvalidUrl = backendUrls.some(be => !be.url.trim());
  if (hasInvalidUrl) {
    showToast('All backend services must have a valid URL', 'error');
    return;
  }

  const hasInvalidRedirection = redirectUrls.some(red => !red.targetUrl.trim());
  if (hasInvalidRedirection) {
    showToast('All API redirections must have a Target URL', 'error');
    return;
  }

  const payload = { name, frontEndUrl, backendUrls, redirectUrls, isActive };

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
        <label class="form-label" style="color:var(--accent-color); font-weight:700;">Path Prefix <span style="font-weight:400; color:var(--text-muted);">(optional — leave empty to match all paths)</span>:</label>
        <input type="text" class="form-control be-prefix" placeholder="e.g. /api  or leave empty to catch all" value="${escapeHtml(be.pathPrefix || '')}">
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

// --- Add-Redirect button inside edit modal ---
document.getElementById('add-redirect-btn').onclick = () => {
  addRedirectRow({ name: '', targetUrl: '' });
};

/**
 * Renders one API redirection row inside the redirect-services-list container.
 * @param {{ id?: string, name: string, targetUrl: string, port?: number }} red
 */
function addRedirectRow(red = { name: '', targetUrl: '', port: null, id: '' }) {
  const list = document.getElementById('redirect-services-list');
  const idx = list.children.length;

  const row = document.createElement('div');
  row.className = 'backend-row';
  row.style.borderColor = 'rgba(234, 179, 8, 0.4)';
  row.dataset.redirectIdx = idx;
  row.dataset.redirectId = red.id || '';
  row.dataset.redirectPort = red.port || '';

  const portDisplay = red.port
    ? `http://localhost:${red.port}`
    : '(assigned automatically after save)';

  row.innerHTML = `
    <div class="backend-row-header">
      <span class="backend-row-title" style="color:#eab308;">🔀 Redirection #${idx + 1}</span>
      <button type="button" class="backend-row-remove">Remove</button>
    </div>
    <div class="backend-row-fields">
      <div class="form-group">
        <label class="form-label">Service Name:</label>
        <input type="text" class="form-control red-name" placeholder="e.g. Payment Gateway" value="${escapeHtml(red.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Target URL *:</label>
        <input type="text" class="form-control red-url" placeholder="https://api.stripe.com" value="${escapeHtml(red.targetUrl || red.url || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" style="color:#eab308; font-weight:700;">Proxy URL (Dedicated Port):</label>
        <input type="text" class="form-control red-port" readonly disabled style="opacity: 0.75; cursor: default; background: var(--bg-hover);" value="${escapeHtml(portDisplay)}">
      </div>
    </div>
  `;

  row.querySelector('.backend-row-remove').onclick = () => {
    row.remove();
    reindexRedirectRows();
  };

  list.appendChild(row);
}

/**
 * Re-index all redirect rows after removal.
 */
function reindexRedirectRows() {
  const list = document.getElementById('redirect-services-list');
  Array.from(list.children).forEach((row, i) => {
    row.querySelector('.backend-row-title').textContent = `🔀 Redirection #${i + 1}`;
  });
}

/**
 * Reads all redirect rows from the list and returns an array of redirect objects.
 * @returns {{ id?: string, name: string, targetUrl: string, port?: number }[]}
 */
function readRedirectRows() {
  const list = document.getElementById('redirect-services-list');
  return Array.from(list.children).map(row => {
    const portVal = parseInt(row.dataset.redirectPort, 10);
    return {
      id: row.dataset.redirectId || undefined,
      name: row.querySelector('.red-name').value.trim(),
      targetUrl: row.querySelector('.red-url').value.trim(),
      port: !isNaN(portVal) && portVal > 0 ? portVal : undefined
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
