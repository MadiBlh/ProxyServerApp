# ProxyServerApp

A local Node.js + TypeScript reverse proxy that intercepts every HTTP and SOAP call between a
front-end and its backend microservices, captures full request/response headers and
bodies to disk organized in date-partitioned folders, streams them live to an integrated inspection dashboard (Monaco
editors), and lets you replay any captured request with custom overrides.

Think "Charles Proxy / Fiddler, but self-hosted in TypeScript & Node.js, configured by a JSON file,
with a web UI instead of a desktop app."

---

## Features

- **TypeScript Architecture** — fully typed with strict type safety, shared domain interfaces (`src/types/index.ts`), and Express Request namespace augmentation.
- **High-Performance Proxy Runtime** — in-memory application config caching and date directory caching to eliminate blocking disk syscalls on the critical request path.
- **Asynchronous Non-Blocking Logging** — request and response files are written asynchronously to disk with an in-memory LRU cache (`MAX_RECENT_LOGS = 200`) for sub-millisecond retrieval.
- **Large Payload Protection** — safety buffer capping (10MB default) prevents memory spikes and crashes on large file transfers while proxying full payloads across the network.
- **Prefix-based routing** — each configured backend declares a `pathPrefix`; the longest matching prefix wins (`src/services/proxyEngine.ts`).
- **Date-partitioned storage** — request/response bodies are stored in `logs/YYYY-MM-DD/`, metadata (headers, status, duration) in `headers/YYYY-MM-DD/`, all keyed by one UUID per transaction.
- **Period & Date Selector** — browse captures by date; defaults to loading only the most recent date folder for optimal startup latency (`/dashboard-api/logs/dates`).
- **Real-Time Live Feed with Frame Batching** — newly captured transactions are pushed instantly to open dashboard tabs via Server-Sent Events (`/dashboard-api/events`) and batch-rendered on `requestAnimationFrame`.
- **Response Compression** — built-in gzip/deflate compression for static assets and REST API endpoints.
- **Graceful Process Shutdown** — handles `SIGINT` and `SIGTERM` to close active SSE clients, terminate redirect proxy servers, and close the HTTP server cleanly.
- **Inspect** — Monaco editor panes auto-detect JSON/XML and pretty-print; cookie headers get special handling.
- **Replay** — re-fire any captured call with edited URL, method, headers and body (`src/services/replayService.ts`).
- **Export** — save a request/response pair straight into your Downloads folder.
- **Archive** — move captured logs for an application into an `archives/` directory organized by app name, preserving them without deletion (`src/services/logManager.ts`).
- **Redirect proxy servers** — apps can declare external API forwarding rules (e.g. a payment gateway). Each external target gets its own dedicated proxy server on an auto-assigned port, fully logged and streamed to the same dashboard feed (`src/services/redirectProxyManager.ts`).
- **Configurable storage paths** — override where `config/`, `logs/`, `headers/` and `archives/` live via `settings.json`, the dashboard Settings API, or environment variables (`src/services/settingsManager.ts`).
- **Loading indicator system** — visual feedback for all dashboard API operations: a global shimmer bar, section-level blur overlays, button spinners, and error toasts driven by a `LoadingManager` singleton and `trackedFetch()` wrapper (`public/js/app.js`).
- **Vector SVG Icons** — crisp, theme-aware inline SVGs throughout the dashboard and docs for dark & light modes.

---

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Start compiled server
npm start

# Or run in development mode with auto-reload
npm run dev
```

The server listens on `0.0.0.0:4000` by default (override with the `PORT` env var):

| URL | Purpose |
| --- | --- |
| `http://localhost:4000/dashboard` | Web dashboard UI |
| `http://localhost:4000/doc` | Full code documentation |
| `http://localhost:4000/dashboard-api/...` | Admin REST API + SSE feed |
| `http://localhost:4000` | Main proxy entry point (Vite proxy target etc.) |

Example Vite configuration:

```js
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // ...any other prefixes your backends declare
    }
  }
};
```

Browser navigations to `http://localhost:4000` are redirected to `/dashboard`
(requests carrying a proxy marker or non-HTML Accept header pass through instead).

---

## Configuration

Applications are defined in `config/applications.json` (auto-seeded with two sample
apps on first run). The dashboard's **Settings** dialog (Web Applications tab) edits this file
through the admin API.

Shape of an application entry:

```json
{
  "id": "app-default-1",
  "name": "Sample JSON Store API",
  "frontEndUrl": "http://localhost:3000",
  "backendUrls": [
    {
      "id": "be-1",
      "name": "JSON Placeholder API",
      "url": "https://jsonplaceholder.typicode.com",
      "pathPrefix": "/posts"
    }
  ],
  "redirectUrls": [
    {
      "id": "redir-sample-1",
      "name": "External Payment API",
      "targetUrl": "http://localhost:9007",
      "port": 4001
    }
  ],
  "isActive": true
}
```

- `backendUrls` are relayed through the main proxy on port 4000, routed by `pathPrefix`.
- `redirectUrls` receive their own dedicated proxy server on an auto-assigned `port`
  (starting at 4001, `REDIRECT_BASE_PORT`). Multiple apps pointing at the same
  `targetUrl` share the same port.
- `isActive: false` excludes an app from routing and stops its redirect proxies.

### Storage paths & environment variables

| Env var | Effect |
| --- | --- |
| `PORT` | Main server port (default `4000`) |
| `REDIRECT_BASE_PORT` | First redirect proxy port (default `4001`) |
| `PROXY_CONFIG_DIR` | Config directory holding `applications.json` |
| `PROXY_LOGS_DIR` | Base directory containing `logs/`, `headers/`, and `archives/` |

If no env var is set, the values stored in `settings.json` (editable via
`PUT /dashboard-api/settings`) are used; otherwise the project-root defaults apply.
Archives are stored in `archives/` under the same base directory as `logs/` and `headers/`.

---

## Admin API

All endpoints are JSON, mounted under `/dashboard-api`, and CORS-enabled.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/settings` | Current storage & path settings |
| PUT | `/settings` | Update storage paths; optionally migrate `applications.json` |
| GET | `/applications` | List configured applications |
| POST | `/applications` | Create an application |
| PUT | `/applications/:id` | Update an application |
| DELETE | `/applications/:id` | Delete an application |
| GET | `/redirect-proxies` | Status of running redirect proxy servers |
| GET | `/logs/dates` | List all available date folder names (`YYYY-MM-DD`) sorted newest first |
| GET | `/logs?appId=&date=&period=&q=&limit=&offset=` | List captured log summaries (defaults to newest date folder; supports pagination and search filters) |
| GET | `/logs/:id?date=` | Full log detail (reqMeta, resMeta, requestBody, responseBody) |
| DELETE | `/logs` | Clear logs (body `{ appId }` or `{ ids: [...] }`; omit body to clear all) |
| DELETE | `/logs/:id` | Delete a single log transaction by ID |
| POST | `/logs/:id/export` | Export request/response pair to `~/Downloads` (body: `{ "fileName": "prefix", "date": "YYYY-MM-DD" }`) |
| POST | `/logs/:id/replay` | Re-play a request with optional overrides |
| POST | `/logs/archive` | Archive all logs for an app to `archives/<appName>/` (body: `{ "appId", "appName" }`) |
| GET | `/events` | Server-Sent Events stream of new captures |

---

## Practical Examples & Integration Guides

### 1. Single-Page App (SPA) Integration (Vite / React / Vue / Angular)

To intercept network calls between your frontend development server and internal backend microservices, configure your dev server proxy to forward API prefixes to `http://localhost:4000`:

#### Vite (`vite.config.ts` or `vite.config.js`)
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Directs calls like /api/v1/users to ProxyServerApp
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Directs billing/checkout calls to ProxyServerApp
      '/billing': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      }
    }
  }
});
```

#### Client API Client (e.g. Axios or Native `fetch`)
```typescript
// When proxying via Vite, relative calls automatically route through ProxyServerApp
const response = await fetch('/api/v1/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice Smith', email: 'alice@example.com' })
});

// Or using an explicit base URL during integration testing:
// const apiClient = axios.create({ baseURL: 'http://localhost:4000' });
```

---

### 2. Multi-Backend Microservice Routing (Longest Prefix Match)

ProxyServerApp matches incoming HTTP requests to configured backend microservices using **longest-prefix-matching**.

```
                           +------------------------+
                           |  Frontend (Port 3000)  |
                           +-----------+------------+
                                       |
                                       v
                           +------------------------+
                           | ProxyServerApp (:4000) |
                           |  (Captures & Inspects) |
                           +----+--------------+----+
                                |              |
        /api/v1/users           |              | /api/v1/users/checkout
        (Matches be-1)          |              | (Matches be-2: longer prefix wins)
                                v              v
                    +--------------+        +--------------------+
                    | User Service |        | Checkout Service   |
                    | (Port 8080)  |        | (Port 8081)        |
                    +--------------+        +--------------------+
```

#### Application Configuration (`config/applications.json`):
```json
{
  "id": "app-ecommerce",
  "name": "E-Commerce Platform",
  "frontEndUrl": "http://localhost:3000",
  "backendUrls": [
    {
      "id": "be-1",
      "name": "General User Service",
      "url": "http://localhost:8080",
      "pathPrefix": "/api/v1/users"
    },
    {
      "id": "be-2",
      "name": "Specialized Checkout Microservice",
      "url": "http://localhost:8081",
      "pathPrefix": "/api/v1/users/checkout"
    }
  ],
  "redirectUrls": [],
  "isActive": true
}
```

- A call to `POST /api/v1/users/checkout/pay` routes to `http://localhost:8081/api/v1/users/checkout/pay` (matches `/api/v1/users/checkout`, length 21).
- A call to `GET /api/v1/users/42/profile` routes to `http://localhost:8080/api/v1/users/42/profile` (matches `/api/v1/users`, length 13).

---

### 3. External 3rd-Party APIs via Redirect Proxies (Stripe, PayPal, OAuth)

When your backend or frontend communicates with 3rd-party SaaS services over HTTPS (such as Stripe, PayPal, SendGrid), routing them through the main port might clash with URL paths.

ProxyServerApp spawns dedicated proxy servers on dedicated ports (e.g. `4001`, `4002`) with automatic SSL certificate management and cookie domain rewriting:

```json
{
  "id": "app-store",
  "name": "Store App",
  "frontEndUrl": "http://localhost:3000",
  "backendUrls": [
    {
      "id": "be-core",
      "name": "Core Backend",
      "url": "http://localhost:5000",
      "pathPrefix": "/api"
    }
  ],
  "redirectUrls": [
    {
      "id": "redir-stripe",
      "name": "Stripe Gateway",
      "targetUrl": "https://api.stripe.com",
      "port": 4001
    }
  ],
  "isActive": true
}
```

In your application code, point the 3rd-party client SDK or base URL to the dedicated redirect port:
```typescript
import Stripe from 'stripe';

// Route Stripe SDK calls through ProxyServerApp redirect proxy on port 4001
const stripe = new Stripe('sk_test_123', {
  apiVersion: '2023-10-16',
  host: 'localhost',
  port: 4001,
  protocol: 'http'
});

// All Stripe API calls are now captured, inspected in Monaco, and logged to logs/YYYY-MM-DD/!
const charge = await stripe.charges.create({
  amount: 2000,
  currency: 'usd',
  source: 'tok_visa'
});
```

---

### 4. Enterprise SOAP / XML API Call Inspection

ProxyServerApp transparently logs and inspects legacy enterprise SOAP / XML payloads with full Content-Type preservation (`text/xml`, `application/soap+xml`).

```bash
curl -X POST http://localhost:4000/ws/stock \
  -H "Content-Type: text/xml; charset=utf-8" \
  -H "SOAPAction: http://example.com/GetStockPrice" \
  -d '<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetStockPrice xmlns="http://example.com/stocks">
      <StockSymbol>GOOGL</StockSymbol>
    </GetStockPrice>
  </soap:Body>
</soap:Envelope>'
```

In the dashboard UI:
1. The transaction displays the XML badge and status code.
2. The Monaco request and response viewer panes automatically format the XML nodes and indent the SOAP envelope.
3. Raw bodies are stored on disk under `logs/YYYY-MM-DD/{uuid}_request.xml`.

---

### 5. Replaying & Modifying Captured Calls

You can re-execute any captured request with customized parameters directly via the Dashboard UI (using the Replay modal with Monaco editors) or programmatically via the Replay API:

#### Programmatic Replay via cURL:
```bash
curl -X POST http://localhost:4000/dashboard-api/logs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/replay \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:8080/api/v1/users/42",
    "method": "PUT",
    "headers": {
      "content-type": "application/json",
      "authorization": "Bearer updated-jwt-token"
    },
    "body": "{\"name\":\"Alice Smith (Updated)\",\"role\":\"admin\"}"
  }'
```

Response:
```json
{
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json; charset=utf-8",
    "x-powered-by": "Express"
  },
  "body": "{\"id\":42,\"name\":\"Alice Smith (Updated)\",\"role\":\"admin\",\"updatedAt\":\"2026-09-19T17:25:00Z\"}"
}
```

The replayed transaction is immediately logged as a fresh entry and streamed live over SSE to the dashboard.

---

## How Request Routing Works

For every unmatched request on the main port, `proxyMiddleware` selects a target:

1. An explicit app id from the URL path (`/proxy/:appId/...`), headers
   (`x-proxy-app-id` / `x-app-id`) or query (`_appId`) pins a specific application.
2. Otherwise all active backends across all active apps are matched by **longest
   `pathPrefix` first**.
3. Fallback: the app whose `frontEndUrl` appears in the `Referer`/`Origin` header
   (used for requests with no useful prefix, e.g. `GET /`).
4. If nothing matches, a 404 lists the configured prefixes.

Redirect URLs are **not** routed through the main port; each one has its own proxy
server (see `src/services/redirectProxyManager.ts`).

---

## Project Structure

```
ProxyServerApp/
|-- server.ts                     Application entry point, compression, graceful shutdown & Express bootstrap
|-- package.json                  Scripts: build, dev, start, test; deps: express, cors, http-proxy, compression
|-- tsconfig.json                 TypeScript compiler configuration (target: ES2022, outDir: dist)
|-- jest.config.js                Jest test runner configured with ts-jest
|-- optimization.md               Performance optimization roadmap & architectural milestones
|-- settings.json                 Optional storage-path overrides (gitignored)
|-- config/
|   '-- applications.json         Persisted app config (auto-created with samples on first run)
|-- logs/
|   '-- YYYY-MM-DD/               Captured request/response BODIES: {uuid}_request.{ext}
|-- headers/
|   '-- YYYY-MM-DD/               Captured METADATA: {uuid}_request.json / _response.json
|-- archives/                     Archived logs organized by app name ({appName}/logs/ + headers/)
|-- dist/                         Compiled JavaScript output from tsc
|-- public/
|   |-- index.html                Dashboard SPA shell (navbar, period selector, loading bar, modals)
|   |-- doc.html                  Full code documentation (served at /doc)
|   |-- css/                      styles.css (Catppuccin design system) + doc.css
|   '-- js/                       app.js (controller + SVG_ICONS + SSE batching), monaco-init.js, doc.js
'-- src/
    |-- server.test.ts            Unit tests for server entry point, compression & graceful shutdown
    |-- routes/
    |   |-- api.ts                All /dashboard-api endpoints (REST + SSE)
    |   '-- api.test.ts           Unit tests for API routes
    |-- services/
    |   |-- configManager.ts      Applications CRUD with in-memory caching + redirect port assignment
    |   |-- configManager.test.ts Unit tests for configManager
    |   |-- logManager.ts         Write/read/clear/archive/export date-partitioned capture files with async I/O
    |   |-- logManager.test.ts    Unit tests for logManager
    |   |-- proxyEngine.ts        Main http-proxy wiring, route matching, SSE broadcaster
    |   |-- proxyEngine.test.ts   Unit tests for proxyEngine
    |   |-- redirectProxyManager.ts Dedicated proxy servers per redirect port
    |   |-- redirectProxyManager.test.ts Unit tests for redirectProxyManager
    |   |-- replayService.ts      Re-fires a captured request via fetch()
    |   |-- replayService.test.ts Unit tests for replayService
    |   |-- settingsManager.ts    Configurable storage paths including archives
    |   '-- settingsManager.test.ts Unit tests for settingsManager
    |-- types/
    |   '-- index.ts              Shared TypeScript interfaces, types & Express Request augmentation
    '-- utils/
        |-- bootstrap.ts          util._extend polyfill (silences DEP0060 warning)
        |-- bootstrap.test.ts     Unit tests for bootstrap
        |-- payload.ts            Buffer payload capping & memory protection utility
        |-- payload.test.ts       Unit tests for payload utility
        |-- uuid.ts               Dependency-free RFC-4122 UUID v4 generator
        '-- uuid.test.ts          Unit tests for uuid
```

Captured files per transaction (keyed by date `YYYY-MM-DD` and a shared UUID `id`):

- `logs/YYYY-MM-DD/{id}_request.{json|xml|...}` — raw request body
- `logs/YYYY-MM-DD/{id}_response.{...}` — raw response body (or `Error: ...`)
- `headers/YYYY-MM-DD/{id}_request.json` — request metadata + headers
- `headers/YYYY-MM-DD/{id}_response.json` — response metadata (code, status, duration, headers)

---

## Development & Testing

```bash
# Run all unit tests (11 suites, 111 tests)
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Compile TypeScript to dist/
npm run build

# Start development server with auto-restart on changes
npm run dev

# Start compiled JavaScript server from dist/
npm start
```

Full line-level documentation (every module, function reference, route table and
code notes) is served by the app itself at
[http://localhost:4000/doc](http://localhost:4000/doc).

## License

MIT