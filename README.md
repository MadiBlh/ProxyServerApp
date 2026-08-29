# ProxyServerApp

A local Node.js reverse proxy that intercepts every HTTP and SOAP call between a
front-end and its backend microservices, captures full request/response headers and
bodies to disk, streams them live to an integrated inspection dashboard (Monaco
editors), and lets you replay any captured request with custom overrides.

Think "Charles Proxy / Fiddler, but self-hosted in Node, configured by a JSON file,
with a web UI instead of a desktop app."

---

## Features

- **Prefix-based routing** — each configured backend declares a `pathPrefix`; the
  longest matching prefix wins (`src/services/proxyEngine.js`).
- **Capture to disk** — request/response bodies are stored in `logs/`, metadata
  (headers, status, duration) in `headers/`, all keyed by one UUID per transaction.
- **Live feed** — newly captured transactions are pushed instantly to open dashboard
  tabs via Server-Sent Events (`/dashboard-api/events`).
- **Inspect** — Monaco editor panes auto-detect JSON/XML and pretty-print; cookie
  headers get special handling.
- **Replay** — re-fire any captured call with edited URL, method, headers and body
  (`src/services/replayService.js`).
- **Export** — save a request/response pair straight into your Downloads folder.
- **Redirect proxy servers** — apps can declare external API forwarding rules (e.g.
  a payment gateway). Each external target gets its own dedicated proxy server on an
  auto-assigned port, fully logged and streamed to the same dashboard feed
  (`src/services/redirectProxyManager.js`).
- **Configurable storage paths** — override where `config/`, `logs/` and `headers/`
  live via `settings.json`, the dashboard Settings API, or environment variables
  (`src/services/settingsManager.js`).

---

## Quick Start

```bash
npm install
npm start        # or: npm run dev   (uses node --watch)
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
| `PROXY_LOGS_DIR` | Base directory containing `logs/` and `headers/` |

If no env var is set, the values stored in `settings.json` (editable via
`PUT /dashboard-api/settings`) are used; otherwise the project-root defaults apply.

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
| GET | `/logs?appId=` | List captured log summaries (optionally filtered) |
| GET | `/logs/:id` | Full log detail (metas + bodies) |
| DELETE | `/logs` | Clear all log files |
| POST | `/logs/:id/export` | Export request/response pair to `~/Downloads` (body: `{ "fileName": "prefix" }`) |
| POST | `/logs/:id/replay` | Re-play a request with optional overrides |
| GET | `/events` | Server-Sent Events stream of new captures |

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
server (see `src/services/redirectProxyManager.js`).

---

## Project Structure

```
ProxyServerApp/
|-- server.js                     Express bootstrap; mounts admin API, static UI, doc page, proxy
|-- package.json                  scripts: start / dev(watch); deps: express, cors, http-proxy
|-- settings.json                 Optional storage-path overrides (gitignored)
|-- config/
|   '-- applications.json         Persisted app config (auto-created with samples on first run)
|-- logs/                         Captured request/response BODIES: {uuid}_request.{ext}
|-- headers/                      Captured METADATA: {uuid}_request.json / _response.json
|-- public/
|   |-- index.html                Dashboard SPA shell
|   |-- doc.html                  Full code documentation (served at /doc)
|   |-- css/                      styles.css (design system) + doc.css
|   '-- js/                       app.js (controller), monaco-init.js, doc.js
'-- src/
    |-- routes/
    |   '-- api.js                All /dashboard-api endpoints (REST + SSE)
    |-- services/
    |   |-- configManager.js      Applications CRUD + redirect port assignment
    |   |-- logManager.js         Write/read/clear/export capture files
    |   |-- proxyEngine.js        Main http-proxy wiring, route matching, SSE broadcaster
    |   |-- redirectProxyManager.js  Dedicated proxy servers per redirect port
    |   |-- replayService.js      Re-fires a captured request via fetch()
    |   '-- settingsManager.js    Configurable storage paths (env / settings.json)
    '-- utils/
        |-- bootstrap.js          util._extend polyfill (silences DEP0060 warning)
        '-- uuid.js               Dependency-free UUID v4 generator
```

Captured files per transaction (keyed by a shared UUID `id`):

- `logs/{id}_request.{json|xml|...}` — raw request body
- `logs/{id}_response.{...}` — raw response body (or `Error: ...`)
- `headers/{id}_request.json` — request metadata + headers
- `headers/{id}_response.json` — response metadata (code, status, duration, headers)

---

## Development

```bash
npm run dev      # restart on file changes (node --watch)
```

Full line-level documentation (every module, function reference, route table and
code notes) is served by the app itself at
[http://localhost:4000/doc](http://localhost:4000/doc).

## License

MIT