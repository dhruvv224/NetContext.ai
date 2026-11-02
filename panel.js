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
const addToSheetBtn = document.getElementById("add-to-sheet-btn");
const sheetCountEl = document.getElementById("sheet-count");
const clearSheetBtn = document.getElementById("clear-sheet-btn");
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
  // Respect the URL filters: an empty match must not fall back to every request.
  return getFilteredLogs()
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
  setDebugDrawerOpen(true);
  appendDebugLog("─── Starting SKU Images ZIP Download ───");

  const bodies = collectAllResponseBodies();
  appendDebugLog(`Collected ${bodies.length} non-empty response body(s) from ${localLogs.length} captured request(s).`);

  if (bodies.length === 0) {
    showStatus("No response data captured yet.", "error");
    appendDebugLog("Aborted: No response bodies captured yet.", "error");
    return;
  }

  let extraction;
  try {
    extraction = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    appendDebugLog(`Extraction exception: ${err.message}`, "error");
    return;
  }

  appendDebugLog(`Extracted ${extraction.count} unique cart_items (${extraction.duplicates} duplicates skipped).`);

  if (extraction.count === 0) {
    showStatus("No cart_items found in captured responses.", "error");
    return;
  }

  const originalBtnText = downloadImagesBtn.textContent;
  downloadImagesBtn.disabled = true;

  try {
    showStatus(`⏳ Downloading images for ${extraction.count} products...`, "success", 0);
    const result = await buildZipInInspectedPage(extraction.cartItems, ({ completed, total }) => {
      downloadImagesBtn.textContent = `⏳ ${completed}/${total} SKUs...`;
      showStatus(`⏳ Downloading SKU images (${completed}/${total})...`, "success", 0);
    });

    if (result.downloadedImages === 0) {
      const firstErr = result.failed[0] ? ` (${result.failed[0].reason})` : "";
      showStatus(`Failed to download any product images${firstErr}.`, "error", 8000);
      appendDebugLog(`❌ 0 images downloaded${firstErr}`, "error");
      return;
    }

    const sizeMb = (result.sizeBytes / 1024 / 1024).toFixed(1);
    const failNote = result.failed.length > 0 ? ` (${result.failed.length} failed)` : "";
    appendDebugLog(`✓ Saved ${result.filename} (${sizeMb} MB) to Downloads.`, "success");
    showStatus(
      `✅ Saved ZIP: ${result.downloadedProducts}/${result.totalProducts} SKUs${failNote}`,
      "success",
      8000
    );
  } catch (err) {
    showStatus("Image ZIP error: " + err.message, "error", 8000);
    appendDebugLog(`Fatal ZIP error: ${err.stack || err.message}`, "error");
  } finally {
    downloadImagesBtn.disabled = false;
    downloadImagesBtn.textContent = originalBtnText;
  }
});

// ── Build the ZIP inside the inspected page ─────────────────────────────────
// cdn.grofers.com only sends CORS headers for https://blinkit.com, so the images are
// fetched from the Blinkit tab itself, which then saves the ZIP as a normal download.

const PAGE_JOB_KEY = "__netcontextSkuZip";
let zipBuilderSource = null;

function evalInPage(expression) {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exception) => {
      if (exception) {
        reject(new Error(exception.value || exception.description || "Could not run code in the page"));
      } else {
        resolve(result);
      }
    });
  });
}

async function loadZipBuilderSource() {
  if (!zipBuilderSource) {
    const response = await fetch(chrome.runtime.getURL("zip-builder.js"));
    zipBuilderSource = await response.text();
  }
  return zipBuilderSource;
}

/**
 * Run buildSkuImagesZip in the inspected page, stream its progress and logs into
 * the panel, and let the page save the finished ZIP.
 */
async function buildZipInInspectedPage(cartItems, onProgress) {
  // Only the fields the ZIP builder reads, to keep the injected script small.
  // sku is computed the same way as the "Add to Sheet" CSV so zip folder names match the sheet's sku column.
  const items = cartItems.map(item => {
    const { sku, product_id, image_url, images, image_urls, media, name, product_name, display_name } = item;
    const resolvedSku = sku || slugifySku(name || product_name || display_name) || String(product_id);
    return { sku: resolvedSku, product_id, image_url, images, image_urls, media };
  });
  const source = await loadZipBuilderSource();

  await evalInPage(`(function () {
${source}
    const job = window.${PAGE_JOB_KEY} = { completed: 0, total: 0, logs: [], done: false, result: null, error: null };
    buildSkuImagesZip(${JSON.stringify(items)}, {
      concurrency: 6,
      onProgress: p => { job.completed = p.completed; job.total = p.total; },
      onDebug: (text, level) => job.logs.push({ text, level }),
    }).then(r => {
      job.result = {
        totalProducts: r.totalProducts,
        downloadedProducts: r.downloadedProducts,
        downloadedImages: r.downloadedImages,
        skippedWithoutImage: r.skippedWithoutImage,
        failed: r.failed,
        sizeBytes: r.zipBytes.byteLength,
        filename: defaultZipFileName(),
      };
      if (r.downloadedImages > 0) triggerZipDownload(r.zipBytes, job.result.filename);
      job.done = true;
    }).catch(err => {
      job.error = String((err && err.message) || err);
      job.done = true;
    });
    return true;
  })()`);

  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 400));
    const state = await evalInPage(`(function () {
      const job = window.${PAGE_JOB_KEY};
      if (!job) return null;
      return { completed: job.completed, total: job.total, logs: job.logs.splice(0), done: job.done, result: job.result, error: job.error };
    })()`);

    if (!state) throw new Error("The page reloaded while the ZIP was being built");
    state.logs.forEach(line => appendDebugLog(line.text, line.level));
    if (state.total) onProgress(state);
    if (state.done) {
      if (state.error) throw new Error(state.error);
      return state.result;
    }
  }
}

// ── Add to Sheet (append-only Snap-Door inventory CSV) ──────────────────────
// Each click extracts whatever cart_items have been captured so far, adds only the
// ones not already in the sheet (deduped by product_id), and re-downloads the full
// accumulated CSV under the same filename (conflictAction: "overwrite") so repeated
// clicks after scrolling for more products grow one file instead of creating many.

// Column order matches Snap-Door's bulk inventory template, using the column names
// its excelParser.js actually maps to product fields (subcategory, images) rather
// than the raw Blinkit response key names (sub_category, image_url).
const SHEET_COLUMNS = [
  "product_id", "merchant_id", "product_name", "quantity", "available_quantity",
  "price", "mrp", "unit", "inventory", "meta", "images", "group_id",
  "merchant_type", "eta_identifier", "brand", "name", "sku", "category",
  "subcategory", "sub_category_label", "category_label",
];

let sheetRows = [];
let sheetProductIds = new Set();
let sheetFilename = null;

/** Snap-Door-style readable SKU: lowercase, hyphenated product name (e.g. "Haldiram's Bhujia" -> "haldiram-s-bhujia"). */
function slugifySku(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickField(item, keys) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function stringifyIfObject(value) {
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return value === undefined || value === null ? "" : value;
}

/** Map a raw cart_item (Blinkit response shape) to one Snap-Door inventory sheet row. */
function mapCartItemToSheetRow(item) {
  return {
    product_id: pickField(item, ["product_id"]),
    merchant_id: pickField(item, ["merchant_id"]),
    product_name: pickField(item, ["product_name", "display_name", "name"]),
    quantity: pickField(item, ["quantity"]),
    available_quantity: pickField(item, ["available_quantity", "inventory"]),
    price: pickField(item, ["price"]),
    mrp: pickField(item, ["mrp", "price"]),
    unit: pickField(item, ["unit"]),
    inventory: pickField(item, ["inventory", "available_quantity"]),
    meta: stringifyIfObject(pickField(item, ["meta"])),
    images: pickField(item, ["image_url", "images", "image_urls"]),
    group_id: pickField(item, ["group_id"]),
    merchant_type: pickField(item, ["merchant_type"]),
    eta_identifier: pickField(item, ["eta_identifier"]),
    brand: pickField(item, ["brand"]),
    name: pickField(item, ["name", "product_name", "display_name"]),
    sku: pickField(item, ["sku"]) || slugifySku(pickField(item, ["name", "product_name", "display_name"])) || String(pickField(item, ["product_id"])),
    category: pickField(item, ["category"]),
    subcategory: pickField(item, ["subcategory", "sub_category"]),
    sub_category_label: pickField(item, ["sub_category_label", "subcategory", "sub_category"]),
    category_label: pickField(item, ["category_label", "category"]),
  };
}

function csvEscape(value) {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows) {
  const lines = rows.map(row => SHEET_COLUMNS.map(col => csvEscape(row[col])).join(","));
  return [SHEET_COLUMNS.join(","), ...lines].join("\r\n");
}

function updateSheetCount() {
  sheetCountEl.textContent = `${sheetRows.length} in sheet`;
}

function downloadSheetCsv() {
  return new Promise((resolve, reject) => {
    const csv = rowsToCsv(sheetRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download(
      { url, filename: sheetFilename, conflictAction: "overwrite", saveAs: false },
      (downloadId) => {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (downloadId === undefined) {
          reject(new Error("Download did not start (check chrome://extensions for errors)."));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

addToSheetBtn.addEventListener("click", async () => {
  appendDebugLog("─── Adding captured products to sheet ───");

  const bodies = collectAllResponseBodies();
  if (bodies.length === 0) {
    showStatus("No response data captured yet.", "error");
    appendDebugLog("Add to Sheet: 0 response bodies available.", "warn");
    return;
  }

  let extraction;
  try {
    extraction = extractCartItemsFromBatch(bodies);
  } catch (err) {
    showStatus("Extraction error: " + err.message, "error");
    appendDebugLog(`Add to Sheet extraction error: ${err.message}`, "error");
    return;
  }

  let added = 0;
  for (const item of extraction.cartItems) {
    const id = item.product_id !== undefined && item.product_id !== null
      ? String(item.product_id)
      : JSON.stringify(item);
    if (sheetProductIds.has(id)) continue;
    sheetProductIds.add(id);
    sheetRows.push(mapCartItemToSheetRow(item));
    added++;
  }

  if (added === 0) {
    showStatus("No new products to add (already in sheet).", "error");
    appendDebugLog(`Add to Sheet: scanned ${extraction.count} cart_item(s), all already in sheet.`, "warn");
    return;
  }

  if (!sheetFilename) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    sheetFilename = `netcontext-inventory-${ts}.csv`;
  }

  addToSheetBtn.disabled = true;
  try {
    await downloadSheetCsv();
    updateSheetCount();
    showStatus(`✅ Sheet updated: +${added} new (total ${sheetRows.length})`, "success");
    appendDebugLog(`Added ${added} new row(s); sheet now has ${sheetRows.length} total → ${sheetFilename}`, "success");
  } catch (err) {
    // Roll back so a failed download doesn't silently mark these rows as already-added.
    for (let i = 0; i < added; i++) {
      const removed = sheetRows.pop();
      if (removed) sheetProductIds.delete(String(removed.product_id));
    }
    showStatus("Sheet download error: " + err.message, "error", 8000);
    appendDebugLog(`Add to Sheet download error: ${err.message}`, "error");
  } finally {
    addToSheetBtn.disabled = false;
  }
});

clearSheetBtn.addEventListener("click", () => {
  sheetRows = [];
  sheetProductIds = new Set();
  sheetFilename = null;
  updateSheetCount();
  showStatus("Sheet cleared. Next 'Add to Sheet' click starts a new CSV file.", "success");
  appendDebugLog("Sheet cleared by user.");
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
