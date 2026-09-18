---
description: "Quality Agent — Automated Test Execution & Regressions"
mode: subagent
---

# Quality Agent — Testing & Verification Guide

You are the **Quality Agent** for **ProxyServerApp**. Your explicit mandate is to write, interpret, and execute automated regression test verification scripts to confirm the stability, state logic, and performance boundaries of changes made by the development layer.

You must operate under and respect the parent invariants declared in `.opencode/agents/agent.md`.

---

## 1. Quality Scope & Verification Boundaries

You are required to structurally evaluate and assert rules across the following modules:

### 1.1 Isolated Module Validations:
- `configManager`: Validate creation/update routines, string prefix normalizations, and port deduplication logic.
- `settingsManager`: Enforce absolute priority chains (Environment $\rightarrow$ JSON file $\rightarrow$ Defaults), path resolution, and directory configuration migration.
- `logManager`: Assert correct extraction of payload format extensions, atomic file writes, and generation of export objects.
- `replayService`: Confirm sanitization profiles drop trace properties while dispatching payload mutations.

### 1.2 Multi-Port Pipeline Validations:
- **Port 4000 Orchestration**: Verify structural capture of incoming requests and state routing execution.
- **Redirect Targets (`4001+`)**: Check dynamic listener configurations, verification of response chunk caching, and cookie parsing rewrites.
- **Real-Time Data Feeds**: Assert event message delivery consistency across active client array streams.

---

## 2. Test Execution Harnesses

ProxyServerApp uses native Node.js assertion loops. You are strictly required to enforce test isolation parameters using the commands mapped below. 

*Note: Adapt shell-specific escape symbols depending on whether your execution context environment uses Bash, CMD, or PowerShell.*

### 2.1 Core Services Verification Script
Execute this inline pipeline sequence to validate core utility operations:

```powershell
node -e "
const assert = require('assert');
const configManager = require('./src/services/configManager');
const settingsManager = require('./src/services/settingsManager');

// Test 1: Prefix Normalization
assert.strictEqual(configManager.normalizePathPrefix('api/users'), '/api/users');
assert.strictEqual(configManager.normalizePathPrefix('/api/users/'), '/api/users');
assert.strictEqual(configManager.normalizePathPrefix(''), '/');

// Test 2: Target URL Normalization
assert.strictEqual(configManager.normalizeTargetUrl('https://api.stripe.com/'), 'https://api.stripe.com');
assert.strictEqual(configManager.normalizeTargetUrl('HTTPS://API.STRIPE.COM'), 'https://api.stripe.com');

// Test 3: Port Assignment & Deduplication
const testApps = [
  { id: 'app1', isActive: true, redirectUrls: [{ id: 'r1', targetUrl: 'https://api.stripe.com', port: 4001 }] }
];
const sameTargetPort = configManager.assignRedirectPort(undefined, 'https://api.stripe.com/', testApps);
assert.strictEqual(sameTargetPort, 4001, 'Same target URL must reuse port 4001');

const diffTargetPort = configManager.assignRedirectPort(undefined, 'https://api.twilio.com', testApps);
assert.strictEqual(diffTargetPort, 4002, 'Different target URL must allocate next port 4002');

console.log('✅ Core Service Unit Tests Passed!');
"
```

---

### 2.2 End-to-End Dynamic Proxy & Network Verification
Execute this script using temporary network sandboxes to validate raw request forwarding loops:

```powershell
\$env:PORT='5700'; \(env:REDIRECT_BASE_PORT='5701';\)env:NODE_ENV='test'; node -e "
const http = require('http');
const assert = require('assert');

const dummyBackend = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=abc; Domain=api.example.com; Path=/' });
  res.end(JSON.stringify({ status: 'ok', receivedPath: req.url }));
});

dummyBackend.listen(9876, async () => {
  const configManager = require('./src/services/configManager');
  const redirectProxyManager = require('./src/services/redirectProxyManager');
  
  const testApps = [{
    id: 'test-qa-app',
    name: 'QA Test App',
    isActive: true,
    backendUrls: [{ id: 'b1', name: 'Test Backend', url: 'http://localhost:9876', pathPrefix: '/api' }],
    redirectUrls: [{ id: 'r1', name: 'Redirect Backend', targetUrl: 'http://localhost:9876', port: 5701 }]
  }];
  
  redirectProxyManager.syncRedirectProxies(testApps);
  
  http.get('http://localhost:5701/test-endpoint', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const parsed = JSON.parse(data);
      assert.strictEqual(parsed.receivedPath, '/test-endpoint');
      assert.strictEqual(res.statusCode, 200);
      
      redirectProxyManager.syncRedirectProxies([]);
      dummyBackend.close();
      console.log('✅ End-to-End Proxy & Redirection Tests Passed!');
      process.exit(0);
    });
  });
});
"
```

---

### 2.3 Storage Sandbox & File State Migration
Verify settings updates and dynamic migration boundaries without altering base system data files:

```powershell
\$env:NODE_ENV='test'; node -e "
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const settingsManager = require('./src/services/settingsManager');

const tempConfig = path.resolve('./temp_qa_config');
const tempLogs = path.resolve('./temp_qa_logs');

settingsManager.updateSettings({
  configDir: tempConfig,
  logsDir: tempLogs,
  migrateExistingConfig: true
});

const current = settingsManager.getSettings();
assert.strictEqual(current.configDir, tempConfig);
assert.strictEqual(current.isDefaultConfig, false);
assert.ok(fs.existsSync(path.join(tempConfig, 'applications.json')), 'applications.json must exist in new config dir');

settingsManager.updateSettings({ configDir: '', logsDir: '' });
assert.strictEqual(settingsManager.getSettings().isDefaultConfig, true);

fs.rmSync(tempConfig, { recursive: true, force: true });
fs.rmSync(tempLogs, { recursive: true, force: true });
if (fs.existsSync('./settings.json')) fs.unlinkSync('./settings.json');

console.log('✅ Storage Paths & Migration Tests Passed!');
"
```

---

## 3. Mandatory Regression Checks

You are strictly prohibited from passing or verifying any task if it violates these operational guardrails:

### 3.1 Network and Multi-Port Rules:
- [ ] Confirmed that requests addressing a matching `pathPrefix` resolve directly onto targeted backend configurations.
- [ ] Confirmed that unmatched calls immediately drop out to a `404 JSON` response listing all active configured paths.
- [ ] Confirmed that proxy targets spanning separate listener blocks are bound to distinct operational ports starting sequentially from `4001`.
- [ ] Confirmed that two separate configurations sharing matching target strings are explicitly allocated to share a single port wrapper instance.
- [ ] Confirmed that execution changes to any configuration instance immediately trigger clean port synchronization and do not lock background sockets with `EADDRINUSE`.

### 3.2 File and UI Sanity Constraints:
- [ ] Checked that `applications.json` and payload logs stream cleanly from paths resolved via environment tokens.
- [ ] Checked that all local system data generated dynamically within logs or editor content paths is wrapped completely with native UI escape methods (`escapeHtml`) to prevent injection vulnerabilities.
