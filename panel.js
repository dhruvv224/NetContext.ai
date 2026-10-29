/**
 * panel.js – Logic for the NetContext DevTools panel.
 *
 * Responsibilities:
 *  1. Capture fetch and XHR requests using the native Chrome DevTools API.
 *  2. Render captured requests in the panel table.
 *  3. Allow the user to copy all logs as pretty-printed JSON.
 *  4. Allow the user to extract and copy unique cart_item objects from responses.
 *  5. Allow the user to download product images as a Snap-Door compatible SKU ZIP ({product_id}/main.<ext>).
 *  6. Provide a built-in diagnostic console (#debug-drawer) to inspect every step and error.
 */

"use strict";

// ── DOM references ──────────────────────────────────────────────────────────
const countEl = document.getElementById("request-count");
const copyBtn = document.getElementById("copy-btn");
const copyCartBtn = document.getElementById("copy-cart-btn");
const downloadImagesBtn = document.getElementById("download-images-btn");
const toggleDebugBtn = document.getElementById("toggle-debug-btn");
const clearBtn = document.getElementById("clear-btn");
const statusMsg = document.getElementById("status-msg");
const emptyState = document.getElementById("empty-state");
const logTable = document.getElementById("log-table");
const logTbody = document.getElementById("log-tbody");
const baseUrlFilter = document.getElementById("base-url-filter");
const exactUrlFilter = document.getElementById("exact-url-filter");

const debugDrawer = document.getElementById("debug-drawer");
const debugLogsEl = document.getElementById("debug-logs");
const copyDebugBtn = document.getElementById("copy-debug-btn");
const clearDebugBtn = document.getElementById("clear-debug-btn");
const closeDebugBtn = document.getElementById("close-debug-btn");

// ── State ───────────────────────────────────────────────────────────────────

/** Local cache of log entries rendered in the table. */
let localLogs = [];

/** Plain-text history of diagnostic lines for easy copy/paste. */
const debugHistory = [];

// ── Built-in Diagnostic Console Helpers ─────────────────────────────────────

function appendDebugLog(message, level = "info") {
  const ts = new Date().toISOString().slice(11, 23);
  const lineText = `[${ts}] ${message}`;
  debugHistory.push(lineText);

  const div = document.createElement("div");
  div.className = `dbg-line dbg-${level}`;
  div.textContent = lineText;
  debugLogsEl.appendChild(div);
  debugLogsEl.scrollTop = debugLogsEl.scrollHeight;
}

function setDebugDrawerOpen(open) {
  if (open) {
    debugDrawer.classList.add("open");
    toggleDebugBtn.classList.add("active");
  } else {
    debugDrawer.classList.remove("open");
    toggleDebugBtn.classList.remove("active");
  }
}

toggleDebugBtn.addEventListener("click", () => {
  const isOpen = debugDrawer.classList.contains("open");
  setDebugDrawerOpen(!isOpen);
});

closeDebugBtn.addEventListener("click", () => setDebugDrawerOpen(false));

clearDebugBtn.addEventListener("click", () => {
  debugHistory.length = 0;
  debugLogsEl.innerHTML = "";
});

copyDebugBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(debugHistory.join("\n"));
    showStatus("✓ Copied debug log to clipboard.", "success");
  } catch (err) {
    showStatus("Failed to copy debug log: " + err.message, "error");
  }
});

// Log initial environment diagnostics on startup
appendDebugLog("NetContext panel initialized.");
if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
  chrome.runtime.sendMessage({ type: "PING" }, res => {
    if (chrome.runtime.lastError) {
      appendDebugLog(`Background service worker check failed: ${chrome.runtime.lastError.message}`, "warn");
    } else if (res && res.ok) {
      appendDebugLog(`Background service worker active (v${res.version}) — FETCH_IMAGE ready.`, "success");
    } else {
      appendDebugLog(
        "Background service worker is running an older version (reload NetContext in chrome://extensions for Tier-1 fetch).",
        "warn"
      );
    }
  });
}

// Re-render table when filters change
baseUrlFilter.addEventListener("input", renderTable);
exactUrlFilter.addEventListener("input", renderTable);

// ── Intercept Requests via DevTools API ──────────────────────────────────────

chrome.devtools.network.onRequestFinished.addListener((request) => {
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
    responseBody: null,
    timestamp: request.startedDateTime || new Date().toISOString()
  };

  localLogs.push(entry);
  renderTable();

  // Asynchronously fetch the response body
  request.getContent((content) => {
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
  appendDebugLog("Page navigated — network log reset.");
});

// ── Rendering ───────────────────────────────────────────────────────────────

function getFilteredLogs() {
  const baseUrl = baseUrlFilter.value.trim();
  const exactUrl = exactUrlFilter.value.trim();

  return localLogs.filter(entry => {
    if (baseUrl && !entry.url.startsWith(baseUrl)) return false;
    if (exactUrl && entry.url !== exactUrl) return false;
    return true;
  });
}

function renderTable() {
  const filteredLogs = getFilteredLogs();
  const count = filteredLogs.length;

  countEl.textContent = count === 1 ? "1 request" : `${count} requests`;

  if (count === 0) {
    emptyState.style.display = "";
    logTable.style.display = "none";
    logTbody.innerHTML = "";
    return;
  }

  emptyState.style.display = "none";
  logTable.style.display = "";

  logTbody.innerHTML = "";
  for (let i = 0; i < count; i++) {
    logTbody.appendChild(buildRow(filteredLogs[i]));
  }
}

function buildRow(entry) {
  const tr = document.createElement("tr");

  const tdMethod = document.createElement("td");
  tdMethod.textContent = entry.method || "–";
  tr.appendChild(tdMethod);

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

  const tdUrl = document.createElement("td");
  tdUrl.textContent = entry.url || "–";
  tdUrl.title = entry.url || "";
  tr.appendChild(tdUrl);

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
    appendDebugLog(`Copied ${filteredLogs.length} request log(s) to clipboard.`, "success");
  } catch (err) {
    showStatus("Failed to copy: " + err.message, "error");
    appendDebugLog(`Copy JSON Logs error: ${err.message}`, "error");
  }
});

// ── Extract Cart Items Helper ───────────────────────────────────────────────

function collectAllResponseBodies() {
  const filtered = getFilteredLogs();
  const sourceLogs = filtered.length > 0 ? filtered : localLogs;
  return sourceLogs
    .map(entry => entry.responseBody)
    .filter(body => typeof body === "string" && body.trim().length > 0);
}

// ── Copy Cart Items ──────────────────────────────────────────────────────────

copyCartBtn.addEventListener("click", async () => {
  const bodies = collectAllResponseBodies();

  if (bodies.length === 0) {
    showStatus("No response data captured yet.", "error");
    appendDebugLog("Copy Cart Items: 0 response bodies available.", "warn");
    return;
  }

  let result;
  try {
    result = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    appendDebugLog(`Extraction error: ${err.message}`, "error");
    return;
  }

  if (result.count === 0) {
    showStatus("No cart_items found in captured responses.", "error");
    appendDebugLog(`Scanned ${bodies.length} response(s), found 0 cart_items.`, "warn");
    return;
  }

  try {
    const json = JSON.stringify(result.cartItems, null, 2);
    await navigator.clipboard.writeText(json);
    showStatus(`Cart items copied ✅ (${result.count} products)`, "success");
    appendDebugLog(`Copied ${result.count} unique cart_items (${result.duplicates} duplicates removed).`, "success");
  } catch (err) {
    showStatus("Failed to copy: " + err.message, "error");
    appendDebugLog(`Clipboard write failed: ${err.message}`, "error");
  }
});

// ── Download SKU Images ZIP (Snap-Door bulk-zip format) ─────────────────────

downloadImagesBtn.addEventListener("click", async () => {
  appendDebugLog("─── Starting SKU Images ZIP Download ───");
  const bodies = collectAllResponseBodies();
  appendDebugLog(`Collected ${bodies.length} non-empty response body(s) from ${localLogs.length} captured request(s).`);

  if (bodies.length === 0) {
    showStatus("No response data captured yet.", "error");
    appendDebugLog("Aborted: No response bodies captured yet.", "error");
    setDebugDrawerOpen(true);
    return;
  }

  let extraction;
  try {
    extraction = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    appendDebugLog(`Extraction exception: ${err.message}`, "error");
    setDebugDrawerOpen(true);
    return;
  }

  appendDebugLog(`Extracted ${extraction.count} unique cart_items (${extraction.duplicates} duplicates skipped).`);

  if (extraction.count === 0) {
    showStatus("No cart_items found in captured responses.", "error");
    setDebugDrawerOpen(true);
    return;
  }

  const originalBtnText = downloadImagesBtn.textContent;
  downloadImagesBtn.disabled = true;

  try {
    showStatus(`⏳ Downloading images for ${extraction.count} products...`, "success", 0);

    const zipResult = await buildSkuImagesZip(extraction.cartItems, {
      concurrency: 5,
      onDebug: appendDebugLog,
      onProgress: ({ completed, total }) => {
        downloadImagesBtn.textContent = `⏳ ${completed}/${total} SKUs...`;
        showStatus(`⏳ Downloading SKU images (${completed}/${total})...`, "success", 0);
      },
    });

    if (zipResult.downloadedImages === 0) {
      const firstErr = zipResult.failed[0] ? ` (${zipResult.failed[0].reason})` : "";
      showStatus(`Failed to download images${firstErr}. Check 🐞 Debug log.`, "error", 8000);
      appendDebugLog(`❌ 0 images downloaded. Opening debug console for details.`, "error");
      setDebugDrawerOpen(true);
      return;
    }

    const method = await triggerZipDownload(zipResult.zipBytes, undefined, appendDebugLog);

    const failNote = zipResult.failed.length > 0 ? ` (${zipResult.failed.length} failed)` : "";
    showStatus(
      `✅ Downloaded ZIP (${zipResult.downloadedProducts}/${zipResult.totalProducts} SKUs via ${method})${failNote}`,
      "success",
      6000
    );

    if (zipResult.failed.length > 0) {
      setDebugDrawerOpen(true);
    }
  } catch (err) {
    showStatus("Image ZIP error: " + err.message, "error", 8000);
    appendDebugLog(`Fatal ZIP error: ${err.stack || err.message}`, "error");
    setDebugDrawerOpen(true);
  } finally {
    downloadImagesBtn.disabled = false;
    downloadImagesBtn.textContent = originalBtnText;
  }
});

// ── Clear Logs ───────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", () => {
  localLogs = [];
  logTbody.innerHTML = "";
  renderTable();
  showStatus("Log cleared.", "success");
  appendDebugLog("Cleared captured network requests.");
});

// ── Status message helper ─────────────────────────────────────────────────

let statusTimer = null;

function showStatus(text, type, durationMs = 3000) {
  statusMsg.textContent = text;
  statusMsg.className = `visible ${type}`;

  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (durationMs > 0) {
    statusTimer = setTimeout(() => {
      statusMsg.className = "";
      statusMsg.textContent = "";
    }, durationMs);
  }
}
