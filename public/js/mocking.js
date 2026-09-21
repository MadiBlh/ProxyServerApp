/* ==========================================================================
   PROXY SERVER LOG — MOCKING & INTERCEPTION CONTROLLER
   ========================================================================== */

let applications = [];
let mockRules = [];
let activeRuleId = null;
let mockEditor = null;
let currentTheme = localStorage.getItem('proxy_theme') || 'dark';

// --- Loading State Manager ---
const LoadingManager = {
  _requestCount: 0,
  _globalBar: null,

  start() {
    this._requestCount++;
    this._showGlobalBar();
  },

  end() {
    this._requestCount = Math.max(0, this._requestCount - 1);
    if (this._requestCount === 0) {
      this._hideGlobalBar();
    }
  },

  _showGlobalBar() {
    if (!this._globalBar) {
      this._globalBar = document.getElementById('global-loading-bar');
    }
    if (this._globalBar) {
      this._globalBar.classList.add('visible');
    }
  },

  _hideGlobalBar() {
    if (!this._globalBar) {
      this._globalBar = document.getElementById('global-loading-bar');
    }
    if (this._globalBar) {
      this._globalBar.classList.remove('visible');
    }
  }
};

async function trackedFetch(url, options) {
  LoadingManager.start();
  try {
    return await fetch(url, options);
  } finally {
    LoadingManager.end();
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Escape HTML utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Theme Management ---
function setupTheme() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  document.documentElement.setAttribute('data-theme', currentTheme);

  if (themeBtn) {
    themeBtn.onclick = () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', currentTheme);
      localStorage.setItem('proxy_theme', currentTheme);
      if (window.monaco && mockEditor) {
        window.monaco.editor.setTheme(currentTheme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte');
      }
    };
  }
}

// --- Monaco Editor Initialization for Mock Body ---
async function initMockEditor() {
  const container = document.getElementById('mock-monaco-container');
  if (!container) return;

  // Initialize Monaco library
  if (!window.monaco) {
    if (typeof initMonacoEditors === 'function') {
      await initMonacoEditors(currentTheme);
    }
  }

  if (window.monaco && !mockEditor) {
    const monacoTheme = currentTheme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte';
    mockEditor = window.monaco.editor.create(container, {
      value: '{\n  "message": "Mock response"\n}',
      language: 'json',
      theme: monacoTheme,
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'Fira Code', monospace",
      contextmenu: true,
      insertSpaces: true,
      tabSize: 4,
      detectIndentation: false
    });
  }
}

// --- Load Data ---
async function loadApplications() {
  try {
    const res = await trackedFetch('/dashboard-api/applications');
    if (!res.ok) throw new Error('Failed to load applications');
    applications = await res.json();
    populateAppDropdowns();
  } catch (err) {
    console.error('Error loading applications:', err);
  }
}

function populateAppDropdowns() {
  const filterSelect = document.getElementById('mock-app-filter');
  const ruleAppSelect = document.getElementById('rule-app-id');

  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="*">All Applications & Global Rules</option>`;
    applications.forEach(app => {
      filterSelect.innerHTML += `<option value="${app.id}">${escapeHtml(app.name)}</option>`;
    });
    filterSelect.value = currentVal || '*';
  }

  if (ruleAppSelect) {
    const currentVal = ruleAppSelect.value;
    ruleAppSelect.innerHTML = `<option value="*">* Global (All Applications)</option>`;
    applications.forEach(app => {
      ruleAppSelect.innerHTML += `<option value="${app.id}">${escapeHtml(app.name)}</option>`;
    });
    ruleAppSelect.value = currentVal || '*';
  }
}

async function loadMockRules() {
  try {
    const filterSelect = document.getElementById('mock-app-filter');
    const appId = filterSelect ? filterSelect.value : '*';
    const url = appId && appId !== '*' ? `/dashboard-api/mocks?appId=${encodeURIComponent(appId)}` : '/dashboard-api/mocks';

    const res = await trackedFetch(url);
    if (!res.ok) throw new Error('Failed to load mock rules');
    mockRules = await res.json();
    renderRulesList();

    // Auto-select rule if activeRuleId still exists, or select first rule, or show empty state
    if (activeRuleId && mockRules.some(r => r.id === activeRuleId)) {
      selectRule(activeRuleId);
    } else if (mockRules.length > 0) {
      selectRule(mockRules[0].id);
    } else {
      showEmptyState();
    }
  } catch (err) {
    console.error('Error loading mock rules:', err);
    showToast('Failed to load mock rules', 'error');
  }
}

// --- Render Sidebar List ---
function renderRulesList() {
  const container = document.getElementById('rules-list-container');
  const countBadge = document.getElementById('rules-count-badge');
  const searchInput = document.getElementById('rules-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (!container) return;

  const filtered = mockRules.filter(r => {
    if (!query) return true;
    return (
      (r.name || '').toLowerCase().includes(query) ||
      (r.urlPattern || '').toLowerCase().includes(query) ||
      (r.method || '').toLowerCase().includes(query)
    );
  });

  if (countBadge) {
    const activeCount = mockRules.filter(r => r.enabled).length;
    countBadge.textContent = `${activeCount}/${mockRules.length} active`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding:20px 10px; text-align:center; color:var(--text-muted); font-size:0.85rem;">
        ${query ? 'No rules match search query' : 'No mock rules configured yet'}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(rule => {
    const isSelected = rule.id === activeRuleId;
    const methodColor = getMethodBadgeColor(rule.method);
    const statusColor = getStatusBadgeColor(rule.statusCode);
    const appName = rule.appId === '*' ? 'Global' : (applications.find(a => a.id === rule.appId)?.name || 'App');

    return `
      <div class="log-row ${isSelected ? 'selected' : ''}" data-rule-id="${rule.id}" style="padding:10px 12px; margin-bottom:6px; border-radius:6px; cursor:pointer; display:flex; flex-direction:column; gap:6px; background:${isSelected ? 'var(--bg-hover)' : 'var(--bg-card)'}; border:1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'};">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:0.88rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">
            ${escapeHtml(rule.name)}
          </strong>
          <label class="switch" style="position:relative; display:inline-block; width:34px; height:18px; margin:0;" onclick="event.stopPropagation();">
            <input type="checkbox" class="rule-toggle-checkbox" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''} style="opacity:0; width:0; height:0;">
            <span class="slider round" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:${rule.enabled ? 'var(--accent-color)' : 'var(--border-color)'}; transition:.2s; border-radius:18px;"></span>
          </label>
        </div>

        <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem;">
          <span style="font-weight:700; padding:1px 5px; border-radius:3px; ${methodColor}">${escapeHtml(rule.method)}</span>
          <span style="font-weight:700; padding:1px 5px; border-radius:3px; ${statusColor}">${rule.statusCode}</span>
          <span style="color:var(--text-muted); font-size:0.72rem; padding:1px 4px; background:var(--bg-main); border-radius:3px;">${escapeHtml(appName)}</span>
        </div>

        <div style="font-family:monospace; font-size:0.75rem; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(rule.urlPattern)}">
          ${escapeHtml(rule.urlPattern)}
        </div>
      </div>
    `;
  }).join('');

  // Attach click listeners to rows
  container.querySelectorAll('.log-row').forEach(row => {
    row.onclick = () => {
      const id = row.dataset.ruleId;
      if (id) selectRule(id);
    };
  });

  // Attach toggle checkbox listeners
  container.querySelectorAll('.rule-toggle-checkbox').forEach(cb => {
    cb.onchange = async (e) => {
      const id = e.target.dataset.id;
      const checked = e.target.checked;
      await toggleRule(id, checked);
    };
  });
}

function getMethodBadgeColor(method) {
  switch ((method || '').toUpperCase()) {
    case 'GET': return 'background:#a6e3a1; color:#181825;';
    case 'POST': return 'background:#89b4fa; color:#181825;';
    case 'PUT': return 'background:#fab387; color:#181825;';
    case 'DELETE': return 'background:#f38ba8; color:#181825;';
    case 'PATCH': return 'background:#cba6f7; color:#181825;';
    default: return 'background:var(--bg-hover); color:var(--text-main);';
  }
}

function getStatusBadgeColor(status) {
  if (status >= 200 && status < 300) return 'background:#a6e3a1; color:#181825;';
  if (status >= 300 && status < 400) return 'background:#89dceb; color:#181825;';
  if (status >= 400 && status < 500) return 'background:#f9e2af; color:#181825;';
  return 'background:#f38ba8; color:#181825;';
}

// --- Select and Populate Rule in Editor ---
function selectRule(ruleId) {
  const rule = mockRules.find(r => r.id === ruleId);
  if (!rule) {
    showEmptyState();
    return;
  }

  activeRuleId = rule.id;
  renderRulesList();

  const emptyState = document.getElementById('editor-empty-state');
  const form = document.getElementById('rule-editor-form');
  if (emptyState) emptyState.style.display = 'none';
  if (form) form.style.display = 'flex';

  document.getElementById('rule-name').value = rule.name || '';
  document.getElementById('rule-app-id').value = rule.appId || '*';
  document.getElementById('rule-enabled').checked = Boolean(rule.enabled);
  document.getElementById('rule-method').value = rule.method || '*';
  document.getElementById('rule-match-type').value = rule.matchType || 'prefix';
  document.getElementById('rule-url-pattern').value = rule.urlPattern || '/';
  document.getElementById('rule-status-code').value = String(rule.statusCode || 200);
  document.getElementById('rule-content-type').value = rule.contentType || 'application/json';

  const delay = rule.delayMs || 0;
  document.getElementById('rule-delay-slider').value = delay;
  document.getElementById('delay-display').textContent = `${delay} ms`;

  // Populate headers
  renderHeadersEditor(rule.headers || {});

  // Set Monaco value
  if (mockEditor) {
    mockEditor.setValue(rule.body || '');
    updateEditorLanguage(rule.contentType || 'application/json');
  }
}

function showEmptyState() {
  activeRuleId = null;
  const emptyState = document.getElementById('editor-empty-state');
  const form = document.getElementById('rule-editor-form');
  if (emptyState) emptyState.style.display = 'flex';
  if (form) form.style.display = 'none';
  renderRulesList();
}

// --- Headers Key-Value Table ---
function renderHeadersEditor(headersObj) {
  const container = document.getElementById('headers-editor-rows');
  if (!container) return;

  const entries = Object.entries(headersObj || {});
  if (entries.length === 0) {
    entries.push(['Content-Type', document.getElementById('rule-content-type').value || 'application/json']);
  }

  container.innerHTML = entries.map(([key, value]) => `
    <div class="header-row" style="display:flex; gap:8px; align-items:center;">
      <input type="text" class="form-control header-key" placeholder="Header Name (e.g. X-Custom-Header)" value="${escapeHtml(key)}" style="flex:1;">
      <input type="text" class="form-control header-value" placeholder="Header Value" value="${escapeHtml(value)}" style="flex:1.5;">
      <button type="button" class="btn btn-error-outline remove-header-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="this.closest('.header-row').remove()">
        &times;
      </button>
    </div>
  `).join('');
}

function addHeaderRow(key = '', val = '') {
  const container = document.getElementById('headers-editor-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'header-row';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  row.innerHTML = `
    <input type="text" class="form-control header-key" placeholder="Header Name" value="${escapeHtml(key)}" style="flex:1;">
    <input type="text" class="form-control header-value" placeholder="Header Value" value="${escapeHtml(val)}" style="flex:1.5;">
    <button type="button" class="btn btn-error-outline remove-header-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="this.closest('.header-row').remove()">
      &times;
    </button>
  `;
  container.appendChild(row);
}

function collectHeaders() {
  const headers = {};
  document.querySelectorAll('#headers-editor-rows .header-row').forEach(row => {
    const key = row.querySelector('.header-key')?.value.trim();
    const val = row.querySelector('.header-value')?.value.trim();
    if (key) {
      headers[key.toLowerCase()] = val || '';
    }
  });
  return headers;
}

function updateEditorLanguage(contentType) {
  if (!mockEditor || !window.monaco) return;
  let lang = 'json';
  if (contentType.includes('xml')) lang = 'xml';
  else if (contentType.includes('html')) lang = 'html';
  else if (contentType.includes('plain')) lang = 'plaintext';

  const model = mockEditor.getModel();
  if (model) window.monaco.editor.setModelLanguage(model, lang);
}

// --- Create / Save / Toggle / Delete Rule Actions ---
function startNewRule(prefill = {}) {
  activeRuleId = null;

  const emptyState = document.getElementById('editor-empty-state');
  const form = document.getElementById('rule-editor-form');
  if (emptyState) emptyState.style.display = 'none';
  if (form) form.style.display = 'flex';

  document.getElementById('rule-name').value = prefill.name || 'New Mock Rule';
  document.getElementById('rule-app-id').value = prefill.appId || '*';
  document.getElementById('rule-enabled').checked = true;
  document.getElementById('rule-method').value = prefill.method || '*';
  document.getElementById('rule-match-type').value = prefill.matchType || 'prefix';
  document.getElementById('rule-url-pattern').value = prefill.urlPattern || '/api/';
  document.getElementById('rule-status-code').value = String(prefill.statusCode || 200);
  document.getElementById('rule-content-type').value = prefill.contentType || 'application/json';

  const delay = prefill.delayMs || 0;
  document.getElementById('rule-delay-slider').value = delay;
  document.getElementById('delay-display').textContent = `${delay} ms`;

  renderHeadersEditor(prefill.headers || { 'content-type': 'application/json' });

  if (mockEditor) {
    mockEditor.setValue(prefill.body || '{\n  "message": "Mock response"\n}');
    updateEditorLanguage(prefill.contentType || 'application/json');
  }

  renderRulesList();
}

async function saveCurrentRule() {
  const name = document.getElementById('rule-name').value.trim();
  const urlPattern = document.getElementById('rule-url-pattern').value.trim();

  if (!name) {
    showToast('Please enter a rule name', 'error');
    document.getElementById('rule-name').focus();
    return;
  }

  if (!urlPattern) {
    showToast('Please enter a URL pattern', 'error');
    document.getElementById('rule-url-pattern').focus();
    return;
  }

  const rulePayload = {
    name,
    appId: document.getElementById('rule-app-id').value,
    enabled: document.getElementById('rule-enabled').checked,
    method: document.getElementById('rule-method').value,
    matchType: document.getElementById('rule-match-type').value,
    urlPattern,
    statusCode: parseInt(document.getElementById('rule-status-code').value, 10) || 200,
    contentType: document.getElementById('rule-content-type').value,
    delayMs: parseInt(document.getElementById('rule-delay-slider').value, 10) || 0,
    headers: collectHeaders(),
    body: mockEditor ? mockEditor.getValue() : ''
  };

  const saveBtn = document.getElementById('save-rule-btn');
  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    let res;
    if (activeRuleId) {
      // Update existing rule
      res = await trackedFetch(`/dashboard-api/mocks/${activeRuleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rulePayload)
      });
    } else {
      // Create new rule
      res = await trackedFetch('/dashboard-api/mocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rulePayload)
      });
    }

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to save mock rule');
    }

    const saved = await res.json();
    showToast(`Rule "${saved.name}" saved successfully`, 'success');
    activeRuleId = saved.id;
    await loadMockRules();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Rule`;
    }
  }
}

async function toggleRule(id, enabled) {
  try {
    const res = await trackedFetch(`/dashboard-api/mocks/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) throw new Error('Failed to toggle rule state');
    const updated = await res.json();
    const item = mockRules.find(r => r.id === id);
    if (item) item.enabled = updated.enabled;
    renderRulesList();
    if (activeRuleId === id) {
      document.getElementById('rule-enabled').checked = updated.enabled;
    }
  } catch (err) {
    showToast(err.message, 'error');
    renderRulesList();
  }
}

async function deleteCurrentRule() {
  if (!activeRuleId) return;
  const rule = mockRules.find(r => r.id === activeRuleId);
  const name = rule ? rule.name : 'this rule';

  if (!confirm(`Are you sure you want to delete mock rule "${name}"?`)) {
    return;
  }

  try {
    const res = await trackedFetch(`/dashboard-api/mocks/${activeRuleId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete mock rule');

    showToast('Mock rule deleted', 'success');
    activeRuleId = null;
    await loadMockRules();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function duplicateCurrentRule() {
  if (!activeRuleId) return;
  const current = mockRules.find(r => r.id === activeRuleId);
  if (!current) return;

  startNewRule({
    ...current,
    name: `${current.name} (Copy)`
  });
}

function formatMockBody() {
  if (!mockEditor || !window.monaco) return;
  const content = mockEditor.getValue();
  if (!content || !content.trim()) return;

  try {
    const parsed = JSON.parse(content);
    mockEditor.setValue(JSON.stringify(parsed, null, 4));
    showToast('JSON formatted with 4-space indentation', 'info');
  } catch {
    // If not JSON, try generic action
    mockEditor.getAction('editor.action.formatDocument')?.run();
  }
}

// --- Check URL Prefills (e.g. from Dashboard "Mock Request" button) ---
function checkUrlPrefill() {
  const params = new URLSearchParams(window.location.search);
  const prefillUrl = params.get('prefillUrl');
  if (prefillUrl) {
    startNewRule({
      name: params.get('prefillName') || `Mock ${params.get('prefillMethod') || 'GET'} ${prefillUrl}`,
      appId: params.get('prefillAppId') || '*',
      method: params.get('prefillMethod') || 'GET',
      urlPattern: prefillUrl,
      statusCode: parseInt(params.get('prefillStatus') || '200', 10),
      body: params.get('prefillBody') || '{\n  "message": "Mock response"\n}',
      contentType: params.get('prefillContentType') || 'application/json'
    });
  }
}

// --- DOM Ready Bootstrap ---
document.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  await initMockEditor();
  await loadApplications();
  await loadMockRules();
  checkUrlPrefill();

  // App Filter change
  const filterSelect = document.getElementById('mock-app-filter');
  if (filterSelect) {
    filterSelect.onchange = () => loadMockRules();
  }

  // Search input
  const searchInput = document.getElementById('rules-search-input');
  if (searchInput) {
    searchInput.oninput = () => renderRulesList();
  }

  // Buttons
  const newRuleBtn = document.getElementById('new-rule-btn');
  if (newRuleBtn) newRuleBtn.onclick = () => startNewRule();

  const emptyCreateBtn = document.getElementById('empty-state-create-btn');
  if (emptyCreateBtn) emptyCreateBtn.onclick = () => startNewRule();

  const saveBtn = document.getElementById('save-rule-btn');
  if (saveBtn) saveBtn.onclick = () => saveCurrentRule();

  const deleteBtn = document.getElementById('delete-rule-btn');
  if (deleteBtn) deleteBtn.onclick = () => deleteCurrentRule();

  const dupBtn = document.getElementById('duplicate-rule-btn');
  if (dupBtn) dupBtn.onclick = () => duplicateCurrentRule();

  const addHeaderBtn = document.getElementById('add-header-btn');
  if (addHeaderBtn) addHeaderBtn.onclick = () => addHeaderRow();

  const formatBtn = document.getElementById('format-body-btn');
  if (formatBtn) formatBtn.onclick = () => formatMockBody();

  // Content type selector auto-updates editor mode
  const ctSelect = document.getElementById('rule-content-type');
  if (ctSelect) {
    ctSelect.onchange = () => updateEditorLanguage(ctSelect.value);
  }

  // Delay slider live update
  const delaySlider = document.getElementById('rule-delay-slider');
  const delayDisplay = document.getElementById('delay-display');
  if (delaySlider && delayDisplay) {
    delaySlider.oninput = () => {
      delayDisplay.textContent = `${delaySlider.value} ms`;
    };
  }
});
