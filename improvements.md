# ProxyServerApp — Future Improvements & Feature Roadmap

This document serves as the central tracking roadmap for upcoming enhancements, developer tools, and architectural features planned for **ProxyServerApp**.

---

## 1. 🔀 Request & Response Mocking / Rule-Based Interception ✅ *(Implemented in v2.0)*

### Overview
Allows developers to define active interception rules per application or global endpoint patterns to simulate edge cases, test error boundaries, inject artificial latency, and mock third-party dependencies directly within ProxyServerApp without modifying backend code.

### Implemented Capabilities
- **Dedicated Mocking Hub (`/mocking`)**:
  - Full-featured, Catppuccin-themed management UI with responsive split sidebar and editor view.
  - Live search filter by rule name, method, URL pattern, and application scope.
  - Active rules count badge in top navigation bar across all pages.
- **Rule Matching Engine**:
  - Method filtering (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`, `*`).
  - URL matching strategies: `exact`, `prefix`, `glob` (e.g. `/api/v1/users/**`), and `regex` patterns.
  - Scoping to specific applications (`appId`) or global application scope (`*`).
- **Response Customization & Synthetic Latency**:
  - Custom HTTP status codes with quick presets (`200 OK`, `201 Created`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests`, `500 Server Error`, `503 Service Unavailable`).
  - Synthetic delay slider and numeric input (`0ms` to `10,000ms`) to test spinners, skeleton loaders, and timeouts.
  - Key-value response header editor with presets and quick deletion.
  - Embedded Monaco editor for rich JSON, XML, HTML, and plain text response payloads with formatting shortcuts.
- **Proxy & Interception Engine Integration**:
  - Intercepts requests on both the primary proxy port (`proxyEngine.ts`) and dedicated redirect proxy ports (`redirectProxyManager.ts`).
  - Logs intercepted calls with `routeType: 'mock'`, highlighted in purple with `⚡ MOCK` badges in the dashboard feed and live SSE stream.
- **Dashboard Quick-Mock Integration**:
  - One-click **"Mock Request"** button on the live dashboard pre-fills rule URL, method, status, and response body into `/mocking`.
- **Persistence & REST API**:
  - JSON file persistence in `<configDir>/mocks.json` with in-memory caching.
  - Complete REST API: `GET /dashboard-api/mocks`, `GET /dashboard-api/mocks/stats`, `GET /dashboard-api/mocks/:id`, `POST /dashboard-api/mocks`, `PUT /dashboard-api/mocks/:id`, `PATCH /dashboard-api/mocks/:id/toggle`, `DELETE /dashboard-api/mocks/:id`.

---

## 2. 👥 Side-by-Side Monaco Diff Viewer

### Overview
Integrate a Monaco Diff Editor into the dashboard to allow instant comparison between any two captured HTTP transactions.

### Planned Capabilities
- **Multi-Select for Comparison**:
  - Select any two rows in the log sidebar and click **"Compare"**.
- **Visual Visualizations**:
  - Request Payload Diff: Side-by-side comparison of POST/PUT bodies.
  - Response Payload Diff: Visual breakdown of payload schema/field changes.
  - Header & Status Diff: Highlight changed, added, or missing HTTP headers and status code discrepancies.
- **Use Cases**:
  - Fast debugging: *"Why did the checkout call succeed for User A but fail with a 500 for User B?"*

---

## 3. 📋 Developer Productivity & Code Generation

### Overview
Speed up daily developer workflows by turning captured network transactions directly into executable code and standard formats.

### Planned Capabilities
- **One-Click "Copy as cURL" / "Copy as Fetch"**:
  - Copy ready-to-run shell `curl` commands or JavaScript `fetch()` snippets from the log detail pane, including exact headers, query parameters, and body payloads.
- **TypeScript Interface Generator**:
  - Automatically parse JSON request and response bodies and generate clean, strongly-typed TypeScript interfaces (`interface UserProfile { ... }`).
- **OpenAPI / Swagger Spec Export**:
  - Aggregate captured endpoints for an application and export an OpenAPI 3.0 specification draft.
- **HAR (HTTP Archive 1.2) Export & Import**:
  - Export filtered log sessions as `.har` files compatible with Chrome DevTools, Postman, Insomnia, and Charles Proxy.
  - Import `.har` files to inspect external debug sessions.

---

## 4. 🧹 Automated Storage Retention & Disk Management ✅ *(Implemented in v2.0.1)*

### Overview
Automated disk lifecycle management and storage diagnostics to prevent unmonitored log growth from consuming disk storage during high-volume testing.

### Implemented Capabilities
- **Storage Metrics & Disk Health Widget**:
  - Real-time segmented visual meter showing breakdown between Active Logs, Headers Metadata, Archives, and Free Host Disk Space.
  - Formatted byte calculations and transaction counts with on-demand refresh.
- **Configurable Retention Policy**:
  - Expiration age thresholds (`Disabled`, `7 Days`, `14 Days`, `30 Days`, `60 Days`, `90 Days`).
  - Automated action for expired logs: `Archive` (compress/move to archive directory) or `Delete` (permanent purge).
  - Manual on-demand enforcement button (**"Apply Retention Now"**) with date partition tracking and reclaimed space stats.
- **One-Click Storage Vacuum**:
  - Scans active date folders, removes empty directories, and reorganizes storage partitions.
- **REST Endpoints**:
  - `GET /dashboard-api/storage/stats`
  - `POST /dashboard-api/storage/vacuum`
  - `POST /dashboard-api/storage/retention/apply`

---

## 5. ⚡ WebSocket & SSE Streaming Proxying

### Overview
Expand proxy inspection capabilities beyond standard request-response cycles to full duplex streaming protocols.

### Planned Capabilities
- **WebSocket Interception (`ws://` and `wss://`)**:
  - Upgrade connection pass-through with message framing inspection.
  - Log incoming and outgoing WebSocket frames (text & JSON) with timestamps.
- **Streaming Response Logging**:
  - Support chunked `text/event-stream` and LLM streaming responses (e.g. OpenAI / Anthropic streaming completions) in the Monaco viewer with live token updates.

---

## 6. 🎨 Dashboard UX & Power-User Features ✅ *(Implemented in v2.0.1)*

### Overview
Refinements and power-user tools that make log exploration faster, smoother, and keyboard-driven.

### Implemented Capabilities
- **Quick Filter Preset Pills**:
  - Instant one-click filter pills in the main toolbar: `All`, `🔴 Errors` (4xx/5xx), `⚡ Mocks` (intercepted rules), `🔀 Redirects` (backend-to-backend proxies), and `⏱️ Slow (>500ms)`.
  - Filter counter badge updating to show matched vs total logs.
- **Keyboard Shortcuts Engine & Overlay Modal (`?` / `h`)**:
  - Quick focus search (`/`), reload logs (`r`), open settings (`s`), go to mock rules (`m`), go to archives (`a`), open docs (`d`), toggle theme (`t`), export request (`e`), replay request (`p`), and close/dismiss modals (`Esc`).
  - Interactive shortcuts cheat-sheet modal accessible via header button or `?` key.
- **Visual Design & Polish**:
  - Sleek Catppuccin Macchiato and Latte styling, smooth badge transitions, and responsive layout polish.
