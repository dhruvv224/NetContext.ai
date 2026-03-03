/**
 * panel.js – Logic for the NetContext DevTools panel.
 *
 * Responsibilities:
 *  1. Capture fetch and XHR requests using the native Chrome DevTools API.
 *  2. Render captured requests in the panel table.
 *  3. Allow the user to copy all logs as pretty-printed JSON.
 *  4. Allow the user to clear the current log.
 */

"use strict";

// ── DOM references ──────────────────────────────────────────────────────────
const countEl = document.getElementById("request-count");
const copyBtn = document.getElementById("copy-btn");
const clearBtn = document.getElementById("clear-btn");
const statusMsg = document.getElementById("status-msg");
const emptyState = document.getElementById("empty-state");
const logTable = document.getElementById("log-table");
const logTbody = document.getElementById("log-tbody");
const baseUrlFilter = document.getElementById("base-url-filter");
const exactUrlFilter = document.getElementById("exact-url-filter");

// ── State ───────────────────────────────────────────────────────────────────

/** Local cache of log entries rendered in the table. */
let localLogs = [];

// Re-render table when filters change
baseUrlFilter.addEventListener("input", renderTable);
exactUrlFilter.addEventListener("input", renderTable);

// ── Intercept Requests via DevTools API ──────────────────────────────────────

chrome.devtools.network.onRequestFinished.addListener((request) => {
  // We only care about fetch and XHR requests.
  // In DevTools, _resourceType can be "fetch" or "xhr".
  const resourceType = request._resourceType || request.resourceType;
  if (resourceType !== "fetch" && resourceType !== "xhr") {
    return;
  }

  const reqHeaders = {};
  if (request.request.headers) {
    request.request.headers.forEach(h => { reqHeaders[h.name] = h.value; });
  }

  const resHeaders = {};
  if (request.response.headers) {
    request.response.headers.forEach(h => { resHeaders[h.name] = h.value; });
  }

  const entry = {
    url: request.request.url,
    method: request.request.method,
    status: request.response.status,
    requestHeaders: reqHeaders,
    responseHeaders: resHeaders,
    responseBody: null, // Fetched asynchronously below
    timestamp: request.startedDateTime || new Date().toISOString()
  };

  localLogs.push(entry);

  // Render the row immediately without waiting for content.
  renderTable();

  // Asynchronously fetch the response body, then update our entry.
  // We can't immediately update the UI with body since it's only in JSON export.
  request.getContent((content, encoding) => {
    if (content) {
      entry.responseBody = content;
    }
  });
});

// Clear local state on navigation.
chrome.devtools.network.onNavigated.addListener(() => {
  localLogs = [];
  logTbody.innerHTML = "";
  renderTable();
});

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Get the currently filtered list of logs.
 */
function getFilteredLogs() {
  const baseUrl = baseUrlFilter.value.trim();
  const exactUrl = exactUrlFilter.value.trim();

  return localLogs.filter(entry => {
    if (baseUrl && !entry.url.startsWith(baseUrl)) return false;
    if (exactUrl && entry.url !== exactUrl) return false;
    return true;
  });
}

/**
 * Re-render the log table and update the request counter.
 */
function renderTable() {
  const filteredLogs = getFilteredLogs();
  const count = filteredLogs.length;

  // Update counter text
  countEl.textContent = count === 1 ? "1 request" : `${count} requests`;

  if (count === 0) {
    emptyState.style.display = "";
    logTable.style.display = "none";
    logTbody.innerHTML = ""; // Clear table when empty
    return;
  }

  emptyState.style.display = "none";
  logTable.style.display = "";

  // Completely rebuild the table since filtering changes the visible set
  logTbody.innerHTML = "";
  for (let i = 0; i < count; i++) {
    logTbody.appendChild(buildRow(filteredLogs[i]));
  }
}

/**
 * Build a <tr> element for a single log entry.
 * @param {Object} entry
 * @returns {HTMLTableRowElement}
 */
function buildRow(entry) {
  const tr = document.createElement("tr");

  // Method
  const tdMethod = document.createElement("td");
  tdMethod.textContent = entry.method || "–";
  tr.appendChild(tdMethod);

  // Status
  const tdStatus = document.createElement("td");
  tdStatus.textContent = entry.status || "–";
  if (entry.status >= 200 && entry.status < 300) {
    tdStatus.className = "status-ok";
  } else if (entry.status >= 300 && entry.status < 400) {
    tdStatus.className = "status-redir";
  } else if (entry.status >= 400) {
    tdStatus.className = "status-err";
  }
  tr.appendChild(tdStatus);

  // URL
  const tdUrl = document.createElement("td");
  tdUrl.textContent = entry.url || "–";
  tdUrl.title = entry.url || "";
  tr.appendChild(tdUrl);

  // Timestamp
  const tdTs = document.createElement("td");
  tdTs.textContent = entry.timestamp || "–";
  tr.appendChild(tdTs);

  return tr;
}

// ── Copy JSON Logs ───────────────────────────────────────────────────────────

copyBtn.addEventListener("click", async () => {
  const filteredLogs = getFilteredLogs();

  if (filteredLogs.length === 0) {
    showStatus("No logs to copy.", "error");
    return;
  }

  try {
    const json = JSON.stringify(filteredLogs, null, 2);
    await navigator.clipboard.writeText(json);
    showStatus(`✓ Copied ${filteredLogs.length} request(s) to clipboard.`, "success");
  } catch (err) {
    showStatus("Failed to copy: " + err.message, "error");
  }
});

// ── Clear Logs ───────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", () => {
  localLogs = [];
  logTbody.innerHTML = "";
  renderTable();
  showStatus("Log cleared.", "success");
});

// ── Status message helper ─────────────────────────────────────────────────

let statusTimer = null;

/**
 * Show a transient status message in the toolbar.
 * @param {string} text
 * @param {"success"|"error"} type
 */
function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `visible ${type}`;

  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsg.className = "";
    statusMsg.textContent = "";
  }, 3000);
}
