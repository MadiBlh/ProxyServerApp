# TypeScript Migration — Implementation Plan Checkpoint

> **Goal**: Rewrite the entire `ProxyServerApp` codebase from JavaScript to TypeScript, add unit tests for every module, and verify the server still works correctly.

---

## Summary of Existing Codebase

| File | Description |
|------|-------------|
| `server.js` | Entry point: Express app setup, CORS, routing, initialization, `app.listen` |
| `src/routes/api.js` | All REST API + SSE route handlers mounted under `/dashboard-api` |
| `src/services/configManager.js` | CRUD for `applications.json`, port assignment logic |
| `src/services/logManager.js` | File-based log read/write/archive/delete/export |
| `src/services/proxyEngine.js` | `http-proxy` middleware, SSE broadcast, request/response interception |
| `src/services/redirectProxyManager.js` | Manages per-port dedicated proxy servers for redirect URLs |
| `src/services/replayService.js` | Replays a captured request using `fetch` |
| `src/services/settingsManager.js` | Reads/writes `settings.json`, resolves dynamic directory paths |
| `src/utils/bootstrap.js` | Patches `util._extend` deprecation warning |
| `src/utils/uuid.js` | Zero-dependency UUID v4 generator |

---

## Implementation Plan (Step-by-step TODO)

### Phase 1 — Project Setup & TypeScript Configuration

- [x] **Step 1** — Install TypeScript and type definitions
  `npm install --save-dev typescript ts-node @types/node @types/express @types/cors @types/http-proxy`

- [x] **Step 2** — Create `tsconfig.json` at project root
  - Target: `ES2020`, module: `CommonJS`
  - `outDir: ./dist`, `rootDir: ./src` (plus `server.ts` at root)
  - Strict mode enabled

- [x] **Step 3** — Install testing framework
  `npm install --save-dev jest ts-jest @types/jest`
  Create `jest.config.js` pointing to `ts-jest` preset

- [x] **Step 4** — Update `package.json` scripts
  Add: `"build"`, `"start:ts"`, `"test"`, `"test:coverage"`
  Keep original `"start"` and `"dev"` scripts pointing at compiled output or `ts-node`

---

### Phase 2 — Shared Types

- [x] **Step 5** — Create `src/types/index.ts`
  Define interfaces/types shared across modules:
  - `BackendUrl` — `{ id, name, url, pathPrefix }`
  - `RedirectUrl` — `{ id, name, targetUrl, port }`
  - `Application` — `{ id, name, frontEndUrl, backendUrls, redirectUrls, isActive }`
  - `LogEntry` — list-level log summary object
  - `ReqMeta`, `ResMeta` — metadata objects saved in header JSON files
  - `AppSettings` — settings object returned by settingsManager
  - `SaveLogEntryParams` — parameter bag for `logManager.saveLogEntry()`
  - `ReplayOptions` — parameter bag for `replayService.replayRequest()`
  - `RunningRedirectProxy` — status object returned by `getRunningRedirects()`
  - `ProxyEntry` — internal map value used by `redirectProxyManager`

---

### Phase 3 — Utils (TypeScript)

- [x] **Step 6** — Rewrite `src/utils/bootstrap.ts`
  Same logic, add proper TS types for `util._extend` patch

- [x] **Step 7** — Rewrite `src/utils/uuid.ts`
  Same UUID v4 logic with TypeScript function signature

---

### Phase 4 — Services (TypeScript)

- [x] **Step 8** — Rewrite `src/services/settingsManager.ts`
  All path resolution logic with typed return values

- [x] **Step 9** — Rewrite `src/services/configManager.ts`
  CRUD operations with full TypeScript types using `Application`, `BackendUrl`, `RedirectUrl`

- [x] **Step 10** — Rewrite `src/services/logManager.ts`
  File I/O log operations with typed parameters and return values

- [x] **Step 11** — Rewrite `src/services/replayService.ts`
  Async `replayRequest()` with typed options and response

- [x] **Step 12** — Rewrite `src/services/proxyEngine.ts`
  `http-proxy` middleware, SSE client management, typed request extensions

- [x] **Step 13** — Rewrite `src/services/redirectProxyManager.ts`
  Dedicated per-port proxy servers, subscriber resolution, sync logic

---

### Phase 5 — Routes (TypeScript)

- [x] **Step 14** — Rewrite `src/routes/api.ts`
  All Express route handlers with typed `Request`/`Response` objects

---

### Phase 6 — Entry Point (TypeScript)

- [x] **Step 15** — Rewrite `server.ts` (at project root)
  App bootstrap, middleware setup, initialization, `app.listen`

---

### Phase 7 — Unit Tests

- [x] **Step 16** — Write unit tests for `src/utils/uuid.ts`
  Tests: format validation, uniqueness, v4 variant bits

- [x] **Step 17** — Write unit tests for `src/utils/bootstrap.ts`
  Tests: `util._extend` override works correctly

- [x] **Step 18** — Write unit tests for `src/services/settingsManager.ts`
  Mock `fs`, test all path resolution functions with env vars / saved settings / defaults

- [x] **Step 19** — Write unit tests for `src/services/configManager.ts`
  Mock `fs` and `settingsManager`, test CRUD ops, `normalizePathPrefix`, `assignRedirectPort`

- [x] **Step 20** — Write unit tests for `src/services/logManager.ts`
  Mock `fs` and `settingsManager`, test `saveLogEntry`, `getAllLogs`, `getLogDetail`, clear/delete/archive/export

- [x] **Step 21** — Write unit tests for `src/services/replayService.ts`
  Mock `logManager` and `fetch`, test success and error paths

- [x] **Step 22** — Write unit tests for `src/services/proxyEngine.ts`
  Mock `http-proxy`, `configManager`, `logManager`, test SSE client registration, middleware routing

- [x] **Step 23** — Write unit tests for `src/routes/api.ts`
  Use `supertest` to test all REST endpoints; mock all service dependencies

---

### Phase 8 — Build & Verification

- [x] **Step 24** — Run TypeScript compilation: `npm run build`
  Verify zero type errors

- [x] **Step 25** — Run full test suite: `npm test`
  Verify all tests pass with acceptable coverage (89/89 tests passed across 9 test suites, >81% coverage)

- [x] **Step 26** — Run server end-to-end smoke test
  Start server, verify dashboard responds at `http://localhost:4000/dashboard` (HTTP 200 OK)

- [x] **Step 27** — Final cleanup
  Update `README.md` to reflect the TypeScript migration

---

## Notes

- The original `.js` files in `src/` are **not deleted** during migration — TypeScript files are written alongside them.
  Once all tests pass, the `.js` source files in `src/` can be removed (the compiled `.js` output lives in `dist/`).
- `http-proxy` requires custom type augmentation for the `buffer` option on `proxy.web()`.
- Extended `Request` properties (e.g. `req._proxyRequestId`) require module augmentation on Express's `Request` interface.
- Tests use `jest.mock()` for all file system operations to avoid touching the real filesystem.
