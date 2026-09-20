// =============================================================================
// Archives Explorer Controller (public/js/archives.js)
// =============================================================================

let archivedApps = [];
let currentAppName = null;
let currentArchivedLogs = [];
let selectedLogId = null;
let selectedLogIds = new Set(); // Multi-selection tracking
let currentTheme = localStorage.getItem('proxy_theme') || 'dark';

// --- Loading Indicators Manager ---
const LoadingManager = {
  activeRequests: 0,
  start() {
    this.activeRequests++;
    const bar = document.getElementById('global-loading-bar');
    if (bar) bar.classList.add('active');
  },
  stop() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.activeRequests === 0) {
      const bar = document.getElementById('global-loading-bar');
      if (bar) bar.classList.remove('active');
    }
  },
  showSection(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) el.classList.add('active');
  },
  hideSection(overlayId) {
    const el = document.getElementById(overlayId);
    if (el) el.classList.remove('active');
  }
};

async function trackedFetch(url, options) {
  LoadingManager.start();
  try {
    const res = await fetch(url, options);
    return res;
  } finally {
    LoadingManager.stop();
  }
}

// --- Toast Notifications ---
function showToast(message, type = 'info', actionText = null, onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'success'
    ? '<svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : type === 'error'
    ? '<svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    : '<svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.alignItems = 'center';
  content.style.gap = '8px';
  content.style.flex = '1';
  content.innerHTML = `<span>${iconSvg}</span><span>${escapeHtml(message)}</span>`;
  toast.appendChild(content);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn btn-sm btn-primary';
    actionBtn.style.marginLeft = '8px';
    actionBtn.textContent = actionText;
    actionBtn.onclick = () => {
      onAction();
      toast.remove();
    };
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
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

// --- Theme Management ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('proxy_theme', theme);
  if (window.monacoManager) {
    window.monacoManager.setMonacoTheme(theme);
  }
}

// --- Clear Buttons Management ---
function updateClearButtons() {
  const epInput = document.getElementById('archive-search-input');
  const epClear = document.getElementById('clear-archive-endpoint-search');
  if (epInput && epClear) {
    epClear.classList.toggle('visible', !!epInput.value);
  }

  const bodyInput = document.getElementById('archive-advanced-search-input');
  const bodyClear = document.getElementById('clear-archive-body-search');
  if (bodyInput && bodyClear) {
    bodyClear.classList.toggle('visible', !!bodyInput.value);
  }
}

// --- Multi-Select UI Sync ---
function updateMultiSelectUI() {
  const multiBar = document.getElementById('archive-multi-select-bar');
  const countBadge = document.getElementById('archive-selected-count');
  const selectAllCb = document.getElementById('archive-select-all-checkbox');

  const count = selectedLogIds.size;
  if (countBadge) countBadge.textContent = String(count);

  if (multiBar) {
    multiBar.style.display = count > 0 ? 'flex' : 'none';
  }

  if (selectAllCb) {
    const totalVisible = currentArchivedLogs.length;
    if (totalVisible === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    } else if (count === totalVisible) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else if (count > 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  }

  // Update item selection visuals in DOM
  const checkEls = document.querySelectorAll('.log-select-checkbox');
  checkEls.forEach(cb => {
    const id = cb.getAttribute('data-id');
    const checked = selectedLogIds.has(id);
    cb.checked = checked;
    const itemEl = cb.closest('.log-item');
    if (itemEl) itemEl.classList.toggle('selected', checked);
  });
}

function clearSelection() {
  selectedLogIds.clear();
  updateMultiSelectUI();
}

// --- Dynamic Button Labels (Context-Aware Restore & Delete) ---
function updateToolbarButtonLabels() {
  const dateVal = document.getElementById('archive-date-dropdown')?.value || 'all';
  const restoreBtn = document.getElementById('restore-app-btn');
  const deleteBtn = document.getElementById('delete-app-btn');

  if (!restoreBtn || !deleteBtn) return;

  if (dateVal && dateVal !== 'all') {
    restoreBtn.textContent = `Restore Date (${dateVal})`;
    restoreBtn.title = `Restore only the archived calls from ${dateVal} back to active logs`;
    deleteBtn.textContent = `Delete Date (${dateVal})`;
    deleteBtn.title = `Permanently delete archived folder for ${dateVal} from disk`;
  } else {
    restoreBtn.textContent = 'Restore All Dates';
    restoreBtn.title = 'Restore all archived historical dates for this application back to active logs';
    deleteBtn.textContent = 'Delete Archive';
    deleteBtn.title = 'Permanently delete this entire application archive from disk';
  }
}

// --- Load Archived Applications ---
async function loadArchivedApps() {
  try {
    const res = await trackedFetch('/dashboard-api/archives');
    archivedApps = await res.json();

    const appDropdown = document.getElementById('archive-app-dropdown');
    appDropdown.innerHTML = '';

    if (!archivedApps || archivedApps.length === 0) {
      appDropdown.innerHTML = '<option value="">No archived applications found</option>';
      document.getElementById('restore-app-btn').disabled = true;
      document.getElementById('delete-app-btn').disabled = true;
      currentAppName = null;
      renderEmptyState('No application archives found. Use "Archive App Logs" in the live dashboard to archive sessions.');
      return;
    }

    document.getElementById('restore-app-btn').disabled = false;
    document.getElementById('delete-app-btn').disabled = false;

    archivedApps.forEach((app, idx) => {
      const opt = document.createElement('option');
      opt.value = app.appName;
      opt.textContent = `${app.appName} (${app.totalTransactions} calls)`;
      if (idx === 0) opt.selected = true;
      appDropdown.appendChild(opt);
    });

    currentAppName = archivedApps[0].appName;
    populateDateDropdown(archivedApps[0]);
    updateToolbarButtonLabels();
    clearSelection();
    await loadArchivedLogs(currentAppName);
  } catch (err) {
    showToast('Failed to load archived applications', 'error');
  }
}

function populateDateDropdown(app) {
  const dateDropdown = document.getElementById('archive-date-dropdown');
  dateDropdown.innerHTML = '<option value="all">All Preserved Dates</option>';

  if (app && Array.isArray(app.dates) && app.dates.length > 0) {
    app.dates.forEach(dateStr => {
      const opt = document.createElement('option');
      opt.value = dateStr;
      opt.textContent = dateStr;
      dateDropdown.appendChild(opt);
    });
  }
  updateToolbarButtonLabels();
}

// --- Load Archived Logs ---
async function loadArchivedLogs(appName) {
  if (!appName) return;

  updateClearButtons();
  const endpointSearch = document.getElementById('archive-search-input')?.value.trim();
  const bodySearch = document.getElementById('archive-advanced-search-input')?.value.trim();
  const dateVal = document.getElementById('archive-date-dropdown')?.value || 'all';

  const params = new URLSearchParams();
  if (endpointSearch) params.set('endpoint', endpointSearch);
  if (bodySearch) params.set('body', bodySearch);
  if (dateVal && dateVal !== 'all') params.set('date', dateVal);

  try {
    LoadingManager.showSection('archives-loading-overlay');
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(appName)}/logs?${params.toString()}`);
    currentArchivedLogs = await res.json();

    renderArchivedLogs(currentArchivedLogs);

    const countBadge = document.getElementById('archived-count-badge');
    if (countBadge) {
      if (endpointSearch || bodySearch) {
        countBadge.textContent = `${currentArchivedLogs.length} MATCHED`;
      } else {
        countBadge.textContent = `${currentArchivedLogs.length} CALLS`;
      }
    }

    if (currentArchivedLogs.length > 0) {
      selectArchivedLog(currentArchivedLogs[0].id);
    } else {
      clearLogDetailsView();
    }
    updateMultiSelectUI();
  } catch (err) {
    showToast('Failed to load archived logs', 'error');
  } finally {
    LoadingManager.hideSection('archives-loading-overlay');
  }
}

function renderArchivedLogs(logs) {
  const container = document.getElementById('archived-logs-list-container');
  container.innerHTML = '';

  const list = logs || [];

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg class="svg-icon empty-state-svg" viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
        </div>
        <p>No archived calls match the filter</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach(log => {
    const li = document.createElement('li');
    const isSelected = selectedLogIds.has(log.id);
    li.className = `log-item ${log.id === selectedLogId ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
    
    li.onclick = (e) => {
      // Don't trigger log detail selection if clicking the checkbox directly
      if (e.target.classList.contains('log-select-checkbox')) return;
      selectArchivedLog(log.id);
    };

    const isOk = log.status === 'OK' || (log.statusCode >= 200 && log.statusCode < 400);
    const dotClass = isOk ? 'green' : 'red';

    const logDate = new Date(log.timestamp);
    const formattedTime = logDate.getFullYear() + '-' +
      String(logDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(logDate.getDate()).padStart(2, '0') + ' ' +
      String(logDate.getHours()).padStart(2, '0') + ':' +
      String(logDate.getMinutes()).padStart(2, '0') + ':' +
      String(logDate.getSeconds()).padStart(2, '0');

    li.innerHTML = `
      <input type="checkbox" class="log-select-checkbox" data-id="${escapeHtml(log.id)}" ${isSelected ? 'checked' : ''} title="Select this archived call">
      <div class="status-dot ${dotClass}" title="Status: ${log.statusCode || 'FAILED'}"></div>
      <div class="log-info">
        <div class="log-endpoint" title="${escapeHtml(log.endpoint)}">${escapeHtml(log.endpoint)}</div>
        <div class="log-meta">
          <span class="method-badge method-${escapeHtml(log.method)}">${escapeHtml(log.method)}</span>
          <span>${escapeHtml(String(log.statusCode || 'ERR'))}</span>
          <span>•</span>
          <span>${formattedTime}</span>
          <span>•</span>
          <span>${escapeHtml(String(log.durationMs || 0))}ms</span>
        </div>
      </div>
    `;

    const checkbox = li.querySelector('.log-select-checkbox');
    if (checkbox) {
      checkbox.onchange = (e) => {
        e.stopPropagation();
        if (e.target.checked) {
          selectedLogIds.add(log.id);
        } else {
          selectedLogIds.delete(log.id);
        }
        updateMultiSelectUI();
      };
    }

    fragment.appendChild(li);
  });

  container.appendChild(fragment);
}

function renderEmptyState(message) {
  const container = document.getElementById('archived-logs-list-container');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg class="svg-icon empty-state-svg" viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
        </div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }
  clearLogDetailsView();
}

// --- Select Archived Log & Inspect in Monaco ---
async function selectArchivedLog(id) {
  selectedLogId = id;

  const items = document.querySelectorAll('.log-item');
  items.forEach(item => {
    const cb = item.querySelector('.log-select-checkbox');
    const itemId = cb?.getAttribute('data-id');
    item.classList.toggle('active', itemId === id);
  });

  const singleRestoreBtn = document.getElementById('restore-single-call-btn');
  if (singleRestoreBtn) singleRestoreBtn.style.display = 'inline-flex';

  const dateVal = document.getElementById('archive-date-dropdown')?.value || 'all';
  const dateParam = dateVal !== 'all' ? `?date=${encodeURIComponent(dateVal)}` : '';

  try {
    LoadingManager.showSection('archive-detail-loading-overlay');
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(currentAppName)}/logs/${id}${dateParam}`);
    const detail = await res.json();

    if (!res.ok || !detail) {
      clearLogDetailsView();
      return;
    }

    renderLogDetails(detail);
  } catch (err) {
    showToast('Failed to load archived call details', 'error');
  } finally {
    LoadingManager.hideSection('archive-detail-loading-overlay');
  }
}

function renderLogDetails(detail) {
  const { reqMeta = {}, resMeta = {}, requestBody = '', responseBody = '' } = detail;

  // Render Top Request Bar
  const methodBadge = document.getElementById('req-method-badge');
  methodBadge.textContent = reqMeta.method || 'GET';
  methodBadge.className = `method-badge method-${reqMeta.method || 'GET'} uppercase`;

  const urlText = document.getElementById('req-url-text');
  urlText.textContent = reqMeta.endpoint || reqMeta.targetUrl || '-';
  urlText.title = reqMeta.targetUrl || reqMeta.endpoint || '';

  // Render Bottom Response Bar
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

  // Auto-highlight active body search query in Monaco
  const bodyQuery = document.getElementById('archive-advanced-search-input')?.value.trim();
  if (bodyQuery && window.monacoManager?.highlightSearchTerm) {
    window.monacoManager.highlightSearchTerm(bodyQuery);
  }
}

function clearLogDetailsView() {
  selectedLogId = null;
  const singleRestoreBtn = document.getElementById('restore-single-call-btn');
  if (singleRestoreBtn) singleRestoreBtn.style.display = 'none';

  document.getElementById('req-method-badge').textContent = 'GET';
  document.getElementById('req-method-badge').className = 'method-badge method-GET uppercase';
  document.getElementById('req-url-text').textContent = 'Select an archived call from the left list';
  document.getElementById('res-status-badge').textContent = '-';
  document.getElementById('res-status-badge').className = 'btn uppercase';
  document.getElementById('res-duration-text').textContent = '-';

  if (window.monacoManager) {
    window.monacoManager.setRequestBodyContent('// Select an archived call to view request body');
    window.monacoManager.setResponseBodyContent('// Select an archived call to view response');
  }

  const reqH = document.getElementById('request-headers-view');
  if (reqH) reqH.innerHTML = '<div class="text-muted" style="padding:12px;">No headers available</div>';
  const resH = document.getElementById('response-headers-view');
  if (resH) resH.innerHTML = '<div class="text-muted" style="padding:12px;">No headers available</div>';
}

function renderHeadersView(containerId, headersObj) {
  const container = document.getElementById(containerId);
  if (!container) return;
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
    const row = document.createElement('div');
    row.className = 'header-row';
    row.innerHTML = `
      <span class="header-key">${escapeHtml(key)}:</span>
      <span class="header-val" style="word-break: break-all;">${escapeHtml(String(val))}</span>
    `;
    container.appendChild(row);
  });
}

// --- Restore Operations (Granular: Date, Selected, Single, All) ---

// 1. Restore Current Date Folder or All Dates
async function restoreCurrentArchive() {
  if (!currentAppName) {
    showToast('Select an archived application first', 'error');
    return;
  }

  const dateVal = document.getElementById('archive-date-dropdown')?.value || 'all';
  const isSingleDate = dateVal !== 'all';
  const promptText = isSingleDate
    ? `Restore archived date folder "${dateVal}" for "${currentAppName}" back into the live active logs?`
    : `Restore ALL historical archived dates for "${currentAppName}" back into the live active logs?`;

  if (!confirm(promptText)) return;

  try {
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(currentAppName)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: isSingleDate ? dateVal : undefined
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore archive');

    showToast(
      data.message || `${data.restored} log(s) restored!`,
      'success',
      'Go to Live Dashboard',
      () => { window.location.href = '/dashboard'; }
    );

    await loadArchivedApps();
  } catch (err) {
    showToast(err.message || 'Restore error', 'error');
  }
}

// 2. Restore Selected Checked Calls
async function restoreSelectedArchiveLogs() {
  if (!currentAppName) {
    showToast('Select an archived application first', 'error');
    return;
  }

  const ids = Array.from(selectedLogIds);
  if (ids.length === 0) {
    showToast('No calls selected to restore', 'info');
    return;
  }

  if (!confirm(`Restore ${ids.length} selected archived call(s) back into the live active logs?`)) {
    return;
  }

  try {
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(currentAppName)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore selected calls');

    showToast(
      data.message || `${data.restored} log(s) restored!`,
      'success',
      'Go to Live Dashboard',
      () => { window.location.href = '/dashboard'; }
    );

    clearSelection();
    await loadArchivedApps();
  } catch (err) {
    showToast(err.message || 'Restore error', 'error');
  }
}

// 3. Restore Single Active Call
async function restoreSingleActiveCall() {
  if (!currentAppName || !selectedLogId) {
    showToast('No call selected', 'error');
    return;
  }

  if (!confirm(`Restore this single call back into the live active logs?`)) {
    return;
  }

  try {
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(currentAppName)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [selectedLogId] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore call');

    showToast(
      '1 call restored to live logs!',
      'success',
      'Go to Live Dashboard',
      () => { window.location.href = '/dashboard'; }
    );

    await loadArchivedApps();
  } catch (err) {
    showToast(err.message || 'Restore error', 'error');
  }
}

// --- Delete Operations (Granular: Single Date Folder vs Entire Archive) ---
async function deleteCurrentArchive() {
  if (!currentAppName) {
    showToast('Select an archived application first', 'error');
    return;
  }

  const dateVal = document.getElementById('archive-date-dropdown')?.value || 'all';
  const isSingleDate = dateVal !== 'all';
  const promptText = isSingleDate
    ? `Permanently delete archived date folder "${dateVal}" for "${currentAppName}" from disk?\n\nThis cannot be undone!`
    : `Permanently delete ALL archives for "${currentAppName}" from disk?\n\nThis cannot be undone!`;

  if (!confirm(promptText)) return;

  try {
    const queryParam = isSingleDate ? `?date=${encodeURIComponent(dateVal)}` : '';
    const res = await trackedFetch(`/dashboard-api/archives/${encodeURIComponent(currentAppName)}${queryParam}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete archive');

    showToast(data.message || 'Archive deleted', 'success');
    await loadArchivedApps();
  } catch (err) {
    showToast(err.message || 'Failed to delete archive', 'error');
  }
}

// --- Search Debouncing ---
let searchTimer = null;
function onSearchInput() {
  updateClearButtons();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (currentAppName) loadArchivedLogs(currentAppName);
  }, 250);
}

// --- Setup Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Monaco
  await window.monacoManager.initMonacoEditors(currentTheme);

  // Apply Theme
  applyTheme(currentTheme);
  document.getElementById('theme-toggle-btn').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
  };

  // App Dropdown Change
  document.getElementById('archive-app-dropdown').onchange = (e) => {
    currentAppName = e.target.value;
    const app = archivedApps.find(a => a.appName === currentAppName);
    populateDateDropdown(app);
    clearSelection();
    loadArchivedLogs(currentAppName);
  };

  // Date Dropdown Change
  document.getElementById('archive-date-dropdown').onchange = () => {
    updateToolbarButtonLabels();
    clearSelection();
    if (currentAppName) loadArchivedLogs(currentAppName);
  };

  // Select All Checkbox
  document.getElementById('archive-select-all-checkbox').onchange = (e) => {
    const checked = e.target.checked;
    if (checked) {
      currentArchivedLogs.forEach(log => selectedLogIds.add(log.id));
    } else {
      selectedLogIds.clear();
    }
    updateMultiSelectUI();
  };

  // Multi-Select Action Bar Buttons
  document.getElementById('archive-restore-selected-btn').onclick = () => {
    restoreSelectedArchiveLogs();
  };

  document.getElementById('archive-clear-selection-btn').onclick = () => {
    clearSelection();
  };

  // Single Call Restore Button in Detail Pane
  const singleRestoreBtn = document.getElementById('restore-single-call-btn');
  if (singleRestoreBtn) {
    singleRestoreBtn.onclick = () => {
      restoreSingleActiveCall();
    };
  }

  // Search Inputs
  document.getElementById('archive-search-input').oninput = () => {
    onSearchInput();
  };
  document.getElementById('archive-advanced-search-input').oninput = () => {
    onSearchInput();
  };

  // Clear Search Buttons
  const clearEpBtn = document.getElementById('clear-archive-endpoint-search');
  if (clearEpBtn) {
    clearEpBtn.onclick = () => {
      const input = document.getElementById('archive-search-input');
      if (input) {
        input.value = '';
        updateClearButtons();
        if (currentAppName) loadArchivedLogs(currentAppName);
        input.focus();
      }
    };
  }

  const clearBodyBtn = document.getElementById('clear-archive-body-search');
  if (clearBodyBtn) {
    clearBodyBtn.onclick = () => {
      const input = document.getElementById('archive-advanced-search-input');
      if (input) {
        input.value = '';
        updateClearButtons();
        if (currentAppName) loadArchivedLogs(currentAppName);
        input.focus();
      }
    };
  }

  // Reload Button
  document.getElementById('reload-archives-btn').onclick = async () => {
    await loadArchivedApps();
    showToast('Archives reloaded', 'success');
  };

  // Context-Aware Restore Button
  document.getElementById('restore-app-btn').onclick = () => {
    restoreCurrentArchive();
  };

  // Context-Aware Delete Button
  document.getElementById('delete-app-btn').onclick = () => {
    deleteCurrentArchive();
  };

  // Tab switching (Body vs Headers)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
      const parentPane = e.target.closest('.detail-pane');
      const targetTab = e.target.getAttribute('data-tab');

      parentPane.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      const isReq = parentPane.id === 'request-pane';
      const monacoContainer = document.getElementById(isReq ? 'request-monaco-container' : 'response-monaco-container');
      const headersView = document.getElementById(isReq ? 'request-headers-view' : 'response-headers-view');

      if (targetTab === 'body') {
        monacoContainer.style.display = 'block';
        headersView.style.display = 'none';
        window.monacoManager.layoutEditors();
      } else {
        monacoContainer.style.display = 'none';
        headersView.style.display = 'flex';
      }
    };
  });

  // Collapsible Panes
  document.getElementById('toggle-sidebar-btn').onclick = () => {
    const sidebar = document.getElementById('log-sidebar');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.getElementById('toggle-sidebar-btn').classList.toggle('collapsed', isCollapsed);
    setTimeout(() => window.monacoManager.layoutEditors(), 220);
  };

  document.getElementById('toggle-request-pane-btn').onclick = () => {
    const pane = document.getElementById('request-pane');
    const isCollapsed = pane.classList.toggle('collapsed');
    document.getElementById('toggle-request-pane-btn').classList.toggle('collapsed', isCollapsed);
    const label = document.querySelector('#toggle-request-pane-btn .collapse-text');
    if (label) label.textContent = isCollapsed ? 'Expand' : 'Collapse';
    setTimeout(() => window.monacoManager.layoutEditors(), 220);
  };

  document.getElementById('toggle-response-pane-btn').onclick = () => {
    const pane = document.getElementById('response-pane');
    const isCollapsed = pane.classList.toggle('collapsed');
    document.getElementById('toggle-response-pane-btn').classList.toggle('collapsed', isCollapsed);
    const label = document.querySelector('#toggle-response-pane-btn .collapse-text');
    if (label) label.textContent = isCollapsed ? 'Expand' : 'Collapse';
    setTimeout(() => window.monacoManager.layoutEditors(), 220);
  };

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.classList.contains('monaco-editor')) {
      e.preventDefault();
      const input = document.getElementById('archive-search-input');
      if (input) {
        input.focus();
        input.select();
      }
    }

    if (e.key === 'Escape') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.id === 'archive-search-input' || activeEl.id === 'archive-advanced-search-input')) {
        if (activeEl.value) {
          activeEl.value = '';
          updateClearButtons();
          if (currentAppName) loadArchivedLogs(currentAppName);
        }
        activeEl.blur();
      }
    }
  });

  // Load initial archives
  await loadArchivedApps();
});
