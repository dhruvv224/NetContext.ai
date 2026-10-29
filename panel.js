/**
 * panel.js – Logic for the NetContext DevTools panel.
 *
 * Responsibilities:
 *  1. Capture fetch and XHR requests using the native Chrome DevTools API.
 *  2. Render captured requests in the panel table.
 *  3. Allow the user to copy all logs as pretty-printed JSON.
 *  4. Allow the user to extract and copy unique cart_item objects from responses.
 *  5. Allow the user to download product images as a Snap-Door compatible SKU ZIP ({product_id}/main.<ext>).
 *  6. Allow the user to clear the current log.
 */

"use strict";

// ── DOM references ──────────────────────────────────────────────────────────
const countEl = document.getElementById("request-count");
const copyBtn = document.getElementById("copy-btn");
const copyCartBtn = document.getElementById("copy-cart-btn");
const downloadImagesBtn = document.getElementById("download-images-btn");
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
    logTbody.innerHTML = "";
    return;
  }

  emptyState.style.display = "none";
  logTable.style.display = "";

  // Rebuild table
  logTbody.innerHTML = "";
  for (let i = 0; i < count; i++) {
    logTbody.appendChild(buildRow(filteredLogs[i]));
  }
}

/**
 * Build a <tr> element for a single log entry.
 */
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
  } catch (err) {
    showStatus("Failed to copy: " + err.message, "error");
  }
});

// ── Extract Cart Items Helper ───────────────────────────────────────────────

/**
 * Gather all non-empty response bodies from the currently filtered logs
 * (or all logs if no URL filter is active) so "Copy Cart Items" and
 * "Download SKU Images" always extract from the exact same responses.
 *
 * @returns {string[]} Array of raw response body strings.
 */
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
    return;
  }

  let result;
  try {
    result = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    return;
  }

  if (result.count === 0) {
    showStatus("No cart_items found in captured responses.", "error");
    return;
  }

  try {
    const json = JSON.stringify(result.cartItems, null, 2);
    await navigator.clipboard.writeText(json);
    showStatus(`Cart items copied ✅ (${result.count} products)`, "success");
  } catch (err) {
    showStatus("Failed to copy: " + err.message, "error");
  }
});

// ── Download SKU Images ZIP (Snap-Door bulk-zip format) ─────────────────────

downloadImagesBtn.addEventListener("click", async () => {
  const bodies = collectAllResponseBodies();

  if (bodies.length === 0) {
    showStatus("No response data captured yet.", "error");
    return;
  }

  let extraction;
  try {
    extraction = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    return;
  }

  if (extraction.count === 0) {
    showStatus("No cart_items found in captured responses.", "error");
    return;
  }

  const originalBtnText = downloadImagesBtn.textContent;
  downloadImagesBtn.disabled = true;

  try {
    showStatus(`⏳ Downloading images for ${extraction.count} products...`, "success", 0);

    const zipResult = await buildSkuImagesZip(extraction.cartItems, {
      concurrency: 5,
      onProgress: ({ completed, total }) => {
        downloadImagesBtn.textContent = `⏳ ${completed}/${total} SKUs...`;
        showStatus(`⏳ Downloading SKU images (${completed}/${total})...`, "success", 0);
      },
    });

    if (zipResult.downloadedImages === 0) {
      const firstErr = zipResult.failed[0] ? ` (${zipResult.failed[0].reason})` : "";
      showStatus(`Failed to download any product images${firstErr}.`, "error", 5000);
      return;
    }

    triggerZipDownload(zipResult.zipBytes);

    const failNote = zipResult.failed.length > 0 ? ` (${zipResult.failed.length} failed)` : "";
    showStatus(
      `✅ Downloaded ZIP: ${zipResult.downloadedProducts}/${zipResult.totalProducts} SKU folders${failNote}`,
      "success",
      5000
    );
  } catch (err) {
    showStatus("Image ZIP error: " + err.message, "error", 5000);
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
});

// ── Status message helper ─────────────────────────────────────────────────

let statusTimer = null;

/**
 * Show a transient status message in the toolbar.
 * @param {string} text
 * @param {"success"|"error"} type
 * @param {number} [durationMs=3000] - Pass 0 to keep visible until next call
 */
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
