# NetContext

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

A minimal Chrome DevTools extension (Manifest V3) that captures **fetch** and **XHR** network requests from the inspected page and lets you copy them as structured JSON logs.

---

## Features

- Custom **"NetContext"** tab inside Chrome DevTools.
- Captures only `fetch` and `XMLHttpRequest` traffic (images, CSS, JS, fonts, etc. are excluded).
- Displays a live request counter.
- Stores per-request details in memory:
  - URL, method, status
  - Request headers
  - Response headers
  - Response body (text, when available)
  - ISO-8601 timestamp
- **Copy JSON Logs** – copies all captured requests as pretty-printed JSON to the clipboard.
- **Clear** – wipes the current log without reloading the page.
- Survives page navigations (interceptor is re-injected automatically).

---

## Project Structure

```
NetContext.ai/
├── manifest.json   – Manifest V3 extension definition
├── background.js   – Service worker; in-memory log store & message relay
├── devtools.html   – DevTools entry-point page (never rendered to the user)
├── devtools.js     – Registers the "NetContext" DevTools panel
├── panel.html      – Panel UI (toolbar, table, empty-state)
└── panel.js        – Panel logic (interceptor injection, polling, rendering)
```

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this repository folder.
4. Open any web page and press **F12** / **⌥⌘I** to open DevTools.
5. Click the **"NetContext"** tab.

---

## Usage

1. With the **NetContext** panel open, navigate to (or reload) any page that makes `fetch` / XHR calls.
2. Requests appear in the table in real time.
3. Click **Copy JSON Logs** to copy the full log to your clipboard.
4. Click **Clear** to reset the log.

---

## Contributing

We welcome contributions from the community! 🎉

> ⚠️ **Direct pushes to `main` are not allowed.** All changes must be submitted via a Pull Request and reviewed before merging.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to:

- Fork the repository and set up your development environment.
- Follow our branching naming conventions.
- Submit a Pull Request.
- Report bugs or request features.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Version

`0.1.0` – initial release.
