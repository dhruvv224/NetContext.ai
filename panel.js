/**
 * panel.js – Logic for the NetContext DevTools panel.
 *
 * Responsibilities:
 *  1. Inject a content script into the inspected page that intercepts
 *     fetch and XHR requests by monkey-patching window.fetch and
 *     XMLHttpRequest.
 *  2. Receive intercepted request data via chrome.devtools.inspectedWindow
 *     eval callbacks and chrome.runtime messaging.
 *  3. Render captured requests in the panel table.
 *  4. Allow the user to copy all logs as pretty-printed JSON.
 *  5. Allow the user to clear the current log.
 *
 * Architecture note:
 *  - The panel page runs in the DevTools context (not the inspected page).
 *  - To inject code into the inspected page we use
 *    chrome.devtools.inspectedWindow.eval().
 *  - Captured data travels back via chrome.runtime messages to background.js
 *    which stores them in memory.  The panel polls / receives these entries
 *    and renders them.
 *
 *  Message flow:
 *   inspected page script → chrome.runtime.sendMessage → background.js
 *   panel.js → chrome.runtime.sendMessage(GET_LOGS) → background.js → panel.js
 */

"use strict";

// ── DOM references ──────────────────────────────────────────────────────────
const countEl    = document.getElementById("request-count");
const copyBtn    = document.getElementById("copy-btn");
const clearBtn   = document.getElementById("clear-btn");
const statusMsg  = document.getElementById("status-msg");
const emptyState = document.getElementById("empty-state");
const logTable   = document.getElementById("log-table");
const logTbody   = document.getElementById("log-tbody");

// ── State ───────────────────────────────────────────────────────────────────

/** Local cache of log entries rendered in the table. */
let localLogs = [];

/** Tab ID of the currently inspected page. */
const INSPECTED_TAB_ID = chrome.devtools.inspectedWindow.tabId;

// ── Inject interceptor into the inspected page ──────────────────────────────

/**
 * Code string that will be eval-ed inside the inspected page.
 *
 * It monkey-patches window.fetch and XMLHttpRequest so that every
 * fetch/XHR request is recorded and sent to the extension background via
 * a custom event captured by the content-script bridge below.
 *
 * IMPORTANT: This code runs in the context of the inspected page and therefore
 * has no access to extension APIs.  Results are forwarded via
 * window.__netContextSend which is injected by the bridge script eval-ed right
 * after.
 */
const INTERCEPTOR_CODE = `
(function () {
  // Avoid double-patching if DevTools panel is reopened.
  if (window.__netContextPatched) return;
  window.__netContextPatched = true;

  /**
   * Send a completed log entry to the extension.
   * __netContextSend is set by the bridge eval below.
   */
  function sendEntry(entry) {
    if (typeof window.__netContextSend === "function") {
      window.__netContextSend(entry);
    }
  }

  // ── Patch fetch ──────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url    = (input instanceof Request) ? input.url : String(input);
    const method = (init && init.method) ||
                   (input instanceof Request ? input.method : "GET");

    const reqHeaders = {};
    if (init && init.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => { reqHeaders[k] = v; });
    } else if (input instanceof Request) {
      input.headers.forEach((v, k) => { reqHeaders[k] = v; });
    }

    const timestamp = new Date().toISOString();
    let response;

    try {
      response = await _origFetch(input, init);
    } catch (err) {
      sendEntry({
        url, method, status: 0,
        requestHeaders: reqHeaders, responseHeaders: {},
        responseBody: null, timestamp
      });
      throw err;
    }

    // Clone so the original stream is not consumed.
    const cloned = response.clone();
    const resHeaders = {};
    cloned.headers.forEach((v, k) => { resHeaders[k] = v; });

    let body = null;
    try {
      body = await cloned.text();
    } catch (_) { /* ignore body read errors */ }

    sendEntry({
      url, method,
      status: response.status,
      requestHeaders: reqHeaders,
      responseHeaders: resHeaders,
      responseBody: body,
      timestamp
    });

    return response;
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────────
  const _XHROpen = XMLHttpRequest.prototype.open;
  const _XHRSend = XMLHttpRequest.prototype.send;
  const _XHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ncMethod  = method;
    this.__ncUrl     = url;
    this.__ncHeaders = {};
    this.__ncTimestamp = new Date().toISOString();
    return _XHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__ncHeaders) this.__ncHeaders[name] = value;
    return _XHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("loadend", () => {
      const resHeaders = {};
      const rawHeaders = this.getAllResponseHeaders();
      if (rawHeaders) {
        rawHeaders.trim().split(/\\r?\\n/).forEach(line => {
          const idx = line.indexOf(":");
          if (idx > -1) {
            resHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
      }

      sendEntry({
        url:             this.__ncUrl     || "",
        method:          this.__ncMethod  || "GET",
        status:          this.status,
        requestHeaders:  this.__ncHeaders || {},
        responseHeaders: resHeaders,
        responseBody:    this.responseType === "" || this.responseType === "text"
                           ? this.responseText
                           : null,
        timestamp: this.__ncTimestamp || new Date().toISOString()
      });
    });

    return _XHRSend.apply(this, args);
  };
})();
`;

/**
 * Code string for the "bridge" that provides __netContextSend inside the page.
 *
 * chrome.devtools.inspectedWindow.eval runs in the page's JS context so we
 * can define a helper that posts messages back to the extension via
 * chrome.runtime.  However, chrome.runtime is NOT available inside the
 * inspected page directly.
 *
 * Instead we use a CustomEvent to communicate from the page to a content
 * script, but since we don't have a content script here, the simplest
 * reliable approach for a DevTools extension is to use the devtools
 * inspectedWindow eval's second argument callback to relay data.
 *
 * The cleanest approach available without a content script:
 *   - Store entries in a global array on the page (window.__netContextQueue).
 *   - Panel polls that queue on an interval via eval.
 */
const BRIDGE_CODE = `
(function () {
  if (!window.__netContextQueue) {
    window.__netContextQueue = [];
  }
  window.__netContextSend = function (entry) {
    window.__netContextQueue.push(entry);
  };
})();
`;

/**
 * Injects the interceptor and bridge into the inspected page.
 * Called once when the panel is first shown, and re-injected on navigation.
 */
function injectInterceptor() {
  chrome.devtools.inspectedWindow.eval(
    BRIDGE_CODE,
    { useContentScriptContext: false },
    (_result, exceptionInfo) => {
      if (exceptionInfo) {
        console.warn("[NetContext] Bridge injection failed:", exceptionInfo.description);
      }
    }
  );
  chrome.devtools.inspectedWindow.eval(
    INTERCEPTOR_CODE,
    { useContentScriptContext: false },
    (_result, exceptionInfo) => {
      if (exceptionInfo) {
        console.warn("[NetContext] Interceptor injection failed:", exceptionInfo.description);
        showStatus("Injection failed – CSP may be blocking the interceptor.", "error");
      }
    }
  );
}

// Inject immediately when the panel loads.
injectInterceptor();

// Re-inject after every navigation so the patches survive page reloads.
chrome.devtools.network.onNavigated.addListener(() => {
  // Clear local state on navigation.
  localLogs = [];
  renderTable();
  injectInterceptor();
});

// ── Polling ─────────────────────────────────────────────────────────────────

/**
 * Whether the panel is currently visible.  We pause polling when hidden to
 * avoid unnecessary work.
 */
let panelVisible = !document.hidden;

// Update visibility state when the user switches DevTools tabs.
document.addEventListener("visibilitychange", () => {
  panelVisible = !document.hidden;
});

/**
 * Drain the queue that the interceptor fills on the inspected page.
 * We poll rather than using a message-passing mechanism to keep the
 * implementation self-contained (no content script required).
 */
function pollQueue() {
  if (!panelVisible) return;

  chrome.devtools.inspectedWindow.eval(
    `(function () {
      var q = window.__netContextQueue;
      if (!q || q.length === 0) return null;
      var entries = q.slice();
      window.__netContextQueue = [];
      return JSON.stringify(entries);
    })()`,
    { useContentScriptContext: false },
    function (result, exceptionInfo) {
      if (exceptionInfo) return; // page not ready yet
      if (!result) return;

      let entries;
      try {
        entries = JSON.parse(result);
      } catch (_) {
        return;
      }

      if (!Array.isArray(entries) || entries.length === 0) return;

      entries.forEach(entry => localLogs.push(entry));
      renderTable();
    }
  );
}

// Poll every 500 ms.
setInterval(pollQueue, 500);

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Re-render the log table and update the request counter.
 */
function renderTable() {
  const count = localLogs.length;

  // Update counter text
  countEl.textContent = count === 1 ? "1 request" : `${count} requests`;

  if (count === 0) {
    emptyState.style.display = "";
    logTable.style.display   = "none";
    return;
  }

  emptyState.style.display = "none";
  logTable.style.display   = "";

  // Rebuild only newly added rows (append only, more efficient).
  const existingRows = logTbody.querySelectorAll("tr").length;
  for (let i = existingRows; i < count; i++) {
    logTbody.appendChild(buildRow(localLogs[i]));
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
  if (localLogs.length === 0) {
    showStatus("No logs to copy.", "error");
    return;
  }

  try {
    const json = JSON.stringify(localLogs, null, 2);
    await navigator.clipboard.writeText(json);
    showStatus(`✓ Copied ${localLogs.length} request(s) to clipboard.`, "success");
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
