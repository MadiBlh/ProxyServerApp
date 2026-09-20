# ProxyServerApp — Future Improvements & Feature Roadmap

This document serves as the central tracking roadmap for upcoming enhancements, developer tools, and architectural features planned for **ProxyServerApp**.

---

## 1. 🔀 Request & Response Mocking / Rule-Based Interception

### Overview
Enable developers to define active interception rules per application or global endpoint patterns to simulate edge cases, test error boundaries, and mock third-party dependencies without writing backend code.

### Planned Capabilities
- **Mock Responses**:
  - Match requests by URL glob/regex, HTTP method, or request body contents.
  - Return custom HTTP status codes (e.g. `400 Bad Request`, `401 Unauthorized`, `402 Payment Required`, `500 Server Error`).
  - Return mock JSON / XML / plain text response payloads with custom response headers.
- **Network Throttling & Latency Simulation**:
  - Inject artificial response delays (e.g. `200ms`, `1500ms`, `5000ms`) to test UI skeleton states, spinner loaders, and timeout handling.
- **Header & Query Tampering**:
  - Automatically append, rewrite, or strip request headers (e.g. test expired vs. refreshed JWT tokens) and query parameters before forwarding to the target.
- **Toggleable Rules in Dashboard UI**:
  - Enable/disable rules dynamically with a single toggle switch from the dashboard.

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

## 4. 🧹 Automated Storage Retention & Disk Management

### Overview
Provide automated disk lifecycle management to prevent log growth from consuming disk storage during high-volume testing.

### Planned Capabilities
- **Configurable Retention Policy**:
  - Set log expiration windows (e.g. keep logs for 7, 14, 30 days, or unlimited).
  - Auto-archive or auto-purge expired daily date partitions (`logs/YYYY-MM-DD`, `headers/YYYY-MM-DD`).
- **Storage Metrics Widget**:
  - Dashboard banner showing disk consumption: Active logs size, Archive logs size, and available system disk space.
- **One-Click Disk Vacuum**:
  - Purge empty date folders and optimize disk storage.

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

## 6. 🎨 Dashboard UX & Power-User Features

### Overview
Refinements to make the UI faster, more customizable, and seamless.

### Planned Capabilities
- **Custom Color-Coded App Badges & Tags**:
  - Assign distinct colors and icons to applications for instant recognition in the unified feed.
- **Saved Search Filters & Presets**:
  - Save frequently used filter combinations (e.g., "5xx Errors Only", "Auth Endpoints", "Slow > 1000ms").
- **Dark / Light Theme Sync**:
  - Auto-detect OS system theme (`prefers-color-scheme`) with smooth theme transitions.
