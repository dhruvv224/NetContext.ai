/**
 * zip-builder.js
 *
 * Lightweight, zero-dependency ZIP archive builder and SKU image downloader
 * tailored for Snap-Door's bulk SKU image upload endpoint:
 *   POST /api/v1/admin/inventory/images/bulk-zip
 *
 * Produces a standard ZIP file structured as:
 *   {SKU}/main.png (or .jpg / .jpeg / .webp)
 * where {SKU} is the uppercase product_id (or sku) matching MasterProduct.sku.
 */

"use strict";

// ── CRC-32 Lookup Table ─────────────────────────────────────────────────────
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Compute CRC-32 checksum for a Uint8Array.
 * @param {Uint8Array} bytes
 * @returns {number} Unsigned 32-bit CRC
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Convert a JS Date into DOS date & time 16-bit integers.
 * @param {Date} date
 * @returns {{ dosTime: number, dosDate: number }}
 */
function toDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Decode a base64 string into a Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64) {
  const clean = base64.replace(/^data:[^;]+;base64,/, "").trim();
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode a Uint8Array into a base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Build a standard PKZIP archive buffer (STORE method) from an array of files.
 * Compatible with AdmZip (used by Snap-door-api) and all standard unzip tools.
 *
 * @param {Array<{ path: string, data: Uint8Array }>} files
 * @returns {Uint8Array} Complete ZIP archive bytes
 */
function createZipArchive(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosTime, dosDate } = toDosDateTime(now);

  const prepared = files.map(file => {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBytes = encoder.encode(normalizedPath);
    const dataBytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const checksum = crc32(dataBytes);
    return {
      nameBytes,
      dataBytes,
      crc: checksum,
      size: dataBytes.byteLength,
    };
  });

  let localSectionSize = 0;
  let centralDirSize = 0;

  for (const entry of prepared) {
    localSectionSize += 30 + entry.nameBytes.byteLength + entry.size;
    centralDirSize += 46 + entry.nameBytes.byteLength;
  }

  const totalSize = localSectionSize + centralDirSize + 22;
  const zipBytes = new Uint8Array(totalSize);
  const view = new DataView(zipBytes.buffer);

  let offset = 0;
  const localHeaderOffsets = [];

  // 1. Write Local File Headers + File Data
  for (const entry of prepared) {
    localHeaderOffsets.push(offset);

    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.size, true);
    view.setUint32(offset + 22, entry.size, true);
    view.setUint16(offset + 26, entry.nameBytes.byteLength, true);
    view.setUint16(offset + 28, 0, true);

    offset += 30;
    zipBytes.set(entry.nameBytes, offset);
    offset += entry.nameBytes.byteLength;

    zipBytes.set(entry.dataBytes, offset);
    offset += entry.size;
  }

  const centralDirOffset = offset;

  // 2. Write Central Directory Headers
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const localOffset = localHeaderOffsets[i];

    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.size, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, entry.nameBytes.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffset, true);

    offset += 46;
    zipBytes.set(entry.nameBytes, offset);
    offset += entry.nameBytes.byteLength;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralDirSize, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true);

  return zipBytes;
}

// ── Snap-Door SKU & Image Helpers ───────────────────────────────────────────

const SNAP_DOOR_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Resolve the normalized SKU for a cart_item object.
 */
function resolveItemSku(item) {
  if (!item || typeof item !== "object") return null;
  const rawSku = item.sku !== undefined && item.sku !== null && String(item.sku).trim() !== ""
    ? String(item.sku).trim()
    : item.product_id !== undefined && item.product_id !== null && String(item.product_id).trim() !== ""
      ? String(item.product_id).trim()
      : null;

  if (!rawSku) return null;

  const sanitized = rawSku
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return sanitized || null;
}

/**
 * Determine a valid Snap-Door image extension (.jpg, .jpeg, .png, .webp).
 */
function resolveImageExtension(imageUrl, contentType = "") {
  try {
    const pathname = new URL(imageUrl).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = pathname.slice(lastDot).toLowerCase();
      if (SNAP_DOOR_ALLOWED_EXT.has(ext)) {
        return ext;
      }
    }
  } catch (_) {}

  const mime = (contentType || "").toLowerCase().split(";")[0].trim();
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";

  return ".png";
}

/**
 * Collect all image URLs associated with a single cart_item.
 */
function extractProductImageUrls(item) {
  if (!item || typeof item !== "object") return [];
  const urls = [];

  if (typeof item.image_url === "string" && /^https?:\/\//i.test(item.image_url.trim())) {
    urls.push(item.image_url.trim());
  }

  const arrayCandidates = [item.images, item.image_urls, item.media];
  for (const list of arrayCandidates) {
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry === "string" && /^https?:\/\//i.test(entry.trim())) {
          urls.push(entry.trim());
        } else if (entry && typeof entry.url === "string" && /^https?:\/\//i.test(entry.url.trim())) {
          urls.push(entry.url.trim());
        }
      }
    }
  }

  return [...new Set(urls)];
}

/**
 * Tier 1: Fetch image via extension background service worker.
 */
function fetchImageViaBackground(url) {
  return new Promise(resolve => {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function"
    ) {
      resolve({ ok: false, reason: "chrome.runtime.sendMessage unavailable" });
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, response => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: `runtime.lastError: ${chrome.runtime.lastError.message}` });
          return;
        }
        if (!response) {
          resolve({ ok: false, reason: "Empty response from background.js" });
          return;
        }
        if (!response.ok || !response.base64) {
          resolve({ ok: false, reason: response.error || "background FETCH_IMAGE returned not ok" });
          return;
        }
        try {
          const bytes = base64ToUint8Array(response.base64);
          if (bytes.byteLength > 0) {
            resolve({
              ok: true,
              bytes,
              contentType: response.contentType || "",
              source: response.source || "background",
            });
          } else {
            resolve({ ok: false, reason: "Decoded 0 bytes from background" });
          }
        } catch (err) {
          resolve({ ok: false, reason: `Base64 decode error: ${err.message}` });
        }
      });
    } catch (err) {
      resolve({ ok: false, reason: `sendMessage exception: ${err.message}` });
    }
  });
}

/**
 * Tier 2: Check if the image is cached in DevTools inspectedWindow resources.
 */
function fetchImageViaDevToolsResource(url) {
  return new Promise(resolve => {
    if (
      typeof chrome === "undefined" ||
      !chrome.devtools ||
      !chrome.devtools.inspectedWindow ||
      typeof chrome.devtools.inspectedWindow.getResources !== "function"
    ) {
      resolve({ ok: false, reason: "inspectedWindow.getResources unavailable" });
      return;
    }

    try {
      chrome.devtools.inspectedWindow.getResources(resources => {
        if (!Array.isArray(resources)) {
          resolve({ ok: false, reason: "No resources array" });
          return;
        }
        const match = resources.find(r => r && r.url === url);
        if (!match || typeof match.getContent !== "function") {
          resolve({ ok: false, reason: "Not in DevTools page resource cache" });
          return;
        }
        match.getContent((content, encoding) => {
          if (!content) {
            resolve({ ok: false, reason: "Resource cache content empty" });
            return;
          }
          try {
            if (encoding === "base64") {
              const bytes = base64ToUint8Array(content);
              if (bytes.byteLength > 0) {
                resolve({ ok: true, bytes, contentType: "", source: "devtools-cache" });
                return;
              }
            }
          } catch (_) {}
          resolve({ ok: false, reason: "Resource cache not base64" });
        });
      });
    } catch (err) {
      resolve({ ok: false, reason: err.message });
    }
  });
}

/**
 * Multi-tier cross-origin image fetcher with detailed diagnostics.
 */
async function fetchImageBytes(url, onDebug = null) {
  const diagnostics = [];

  // 1. Try background service worker
  const bgRes = await fetchImageViaBackground(url);
  if (bgRes.ok) {
    return { bytes: bgRes.bytes, contentType: bgRes.contentType, source: bgRes.source };
  }
  diagnostics.push(`T1(bg): ${bgRes.reason}`);

  // 2. Try DevTools inspectedWindow cached resources
  const dtRes = await fetchImageViaDevToolsResource(url);
  if (dtRes.ok) {
    return { bytes: dtRes.bytes, contentType: dtRes.contentType, source: dtRes.source };
  }
  diagnostics.push(`T2(cache): ${dtRes.reason}`);

  // 3. Try direct fetch + CORS proxies from current context
  const fetchCandidates = [
    { name: "T3(direct)", target: url },
    { name: "T4(wsrv.nl)", target: `https://wsrv.nl/?url=${encodeURIComponent(url)}` },
    { name: "T5(corsproxy.io)", target: `https://corsproxy.io/?${encodeURIComponent(url)}` },
  ];

  for (const candidate of fetchCandidates) {
    try {
      const response = await fetch(candidate.target, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      if (bytes.byteLength === 0) {
        throw new Error("0 bytes");
      }
      return { bytes, contentType, source: candidate.name };
    } catch (err) {
      diagnostics.push(`${candidate.name}: ${err.message || String(err)}`);
    }
  }

  const fullReason = diagnostics.join(" | ");
  if (onDebug) {
    onDebug(`❌ All fetch tiers failed for ${url} -> ${fullReason}`, "error");
  }
  throw new Error(fullReason);
}

/**
 * Download images for all cart_items and package them into a Snap-Door compatible
 * ZIP archive (`{SKU}/main.png`, `{SKU}/image_2.png`, etc.).
 */
async function buildSkuImagesZip(cartItems, options = {}) {
  const concurrency = options.concurrency || 5;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const onDebug = typeof options.onDebug === "function" ? options.onDebug : null;

  const log = (msg, level = "info") => {
    if (onDebug) onDebug(msg, level);
  };

  const skuTasks = [];
  const seenSkus = new Set();
  let skippedWithoutImage = 0;

  for (const item of cartItems) {
    const sku = resolveItemSku(item);
    if (!sku || seenSkus.has(sku)) continue;

    const urls = extractProductImageUrls(item);
    if (urls.length === 0) {
      skippedWithoutImage++;
      log(`⚠️ SKU ${sku} has no valid image_url, skipping.`, "warn");
      continue;
    }

    seenSkus.add(sku);
    skuTasks.push({ sku, urls, item });
  }

  log(`Found ${skuTasks.length} unique SKUs with image URLs (${skippedWithoutImage} without images).`);

  const zipFiles = [];
  const failed = [];
  let completed = 0;
  let downloadedProducts = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < skuTasks.length) {
      const index = cursor++;
      const task = skuTasks[index];
      let productHasImage = false;

      for (let imgIdx = 0; imgIdx < task.urls.length; imgIdx++) {
        const url = task.urls[imgIdx];
        try {
          const { bytes, contentType, source } = await fetchImageBytes(url, onDebug);
          const ext = resolveImageExtension(url, contentType);
          const baseName = imgIdx === 0 ? "main" : `image_${imgIdx + 1}`;
          const entryPath = `${task.sku}/${baseName}${ext}`;

          zipFiles.push({ path: entryPath, data: bytes });
          productHasImage = true;
          log(`✓ [${task.sku}] ${entryPath} (${(bytes.byteLength / 1024).toFixed(1)} KB via ${source})`, "success");
        } catch (err) {
          failed.push({
            sku: task.sku,
            url,
            reason: err && err.message ? err.message : String(err),
          });
        }
      }

      if (productHasImage) {
        downloadedProducts++;
      }

      completed++;
      if (onProgress) {
        onProgress({
          completed,
          total: skuTasks.length,
          sku: task.sku,
        });
      }
    }
  }

  const workerCount = Math.min(concurrency, skuTasks.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  zipFiles.sort((a, b) => a.path.localeCompare(b.path));

  log(`Packaging ${zipFiles.length} image(s) into PKZIP archive...`);
  const zipBytes = zipFiles.length > 0 ? createZipArchive(zipFiles) : new Uint8Array(0);
  log(`ZIP archive ready: ${(zipBytes.byteLength / 1024).toFixed(1)} KB (${zipBytes.byteLength} bytes).`);

  return {
    zipBytes,
    totalProducts: skuTasks.length,
    downloadedProducts,
    downloadedImages: zipFiles.length,
    failed,
    skippedWithoutImage,
  };
}

/**
 * Trigger a browser file download for a Uint8Array ZIP archive.
 * Uses a 4-tier download strategy because Chrome DevTools panel iframes often
 * ignore standard `<a download>` clicks:
 *  1. `chrome.downloads.download` directly (if available in panel)
 *  2. `chrome.devtools.inspectedWindow.eval` (triggers Blob download in top-level inspected tab!)
 *  3. `chrome.runtime.sendMessage({ type: "DOWNLOAD_FILE" })` via background.js
 *  4. Local `<a download>` click in current document (for standalone test-extractor.html)
 *
 * @param {Uint8Array} zipBytes
 * @param {string} [filename]
 * @param {function} [onDebug]
 * @returns {Promise<string>} Name of download method that succeeded
 */
async function triggerZipDownload(zipBytes, filename, onDebug = null) {
  const log = (msg, level = "info") => {
    if (onDebug) onDebug(msg, level);
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const finalName = filename || `sku-images-${timestamp}.zip`;

  // Method 1: Native chrome.downloads.download in current context
  if (typeof chrome !== "undefined" && chrome.downloads && typeof chrome.downloads.download === "function") {
    try {
      const blob = new Blob([zipBytes], { type: "application/zip" });
      const blobUrl = URL.createObjectURL(blob);
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({ url: blobUrl, filename: finalName, saveAs: false }, id => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        });
      });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      log(`✓ Triggered download via chrome.downloads.download (id=${downloadId})`, "success");
      return "chrome.downloads";
    } catch (err) {
      log(`Download Tier 1 (chrome.downloads) failed: ${err.message}`, "warn");
    }
  }

  // Method 2: Trigger download in the top-level inspected page via chrome.devtools.inspectedWindow.eval
  // This bypasses the DevTools iframe sandbox completely without needing any extension reload!
  if (
    typeof chrome !== "undefined" &&
    chrome.devtools &&
    chrome.devtools.inspectedWindow &&
    typeof chrome.devtools.inspectedWindow.eval === "function"
  ) {
    try {
      log(`Sending ZIP (${(zipBytes.byteLength / 1024).toFixed(1)} KB) to inspected tab for download...`);
      const base64Zip = uint8ArrayToBase64(zipBytes);
      const evalScript = `
        (function() {
          try {
            var b64 = ${JSON.stringify(base64Zip)};
            var bin = atob(b64);
            var len = bin.length;
            var arr = new Uint8Array(len);
            for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
            var blob = new Blob([arr], { type: "application/zip" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = ${JSON.stringify(finalName)};
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 15000);
            return { ok: true };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })()
      `;

      const evalResult = await new Promise(resolve => {
        chrome.devtools.inspectedWindow.eval(evalScript, (result, exceptionInfo) => {
          if (exceptionInfo) {
            resolve({ ok: false, error: exceptionInfo.value || exceptionInfo.description || "eval error" });
          } else {
            resolve(result || { ok: false, error: "no eval result" });
          }
        });
      });

      if (evalResult && evalResult.ok) {
        log(`✓ Triggered download in top-level inspected tab (${finalName})`, "success");
        return "inspectedWindow.eval";
      } else {
        log(`Download Tier 2 (inspectedWindow.eval) failed: ${evalResult?.error}`, "warn");
      }
    } catch (err) {
      log(`Download Tier 2 exception: ${err.message}`, "warn");
    }
  }

  // Method 3: Fallback to local <a download> click (works in standalone test-extractor.html)
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  log(`✓ Triggered download via local <a download> (${finalName})`, "success");
  return "anchor-click";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createZipArchive,
    resolveItemSku,
    resolveImageExtension,
    extractProductImageUrls,
    fetchImageBytes,
    buildSkuImagesZip,
    triggerZipDownload,
  };
}
