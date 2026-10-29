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

  // Calculate total byte size
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

    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true);     // Version needed to extract (2.0)
    view.setUint16(offset + 6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(offset + 8, 0, true);      // Compression method (0 = STORE)
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.size, true); // Compressed size
    view.setUint32(offset + 22, entry.size, true); // Uncompressed size
    view.setUint16(offset + 26, entry.nameBytes.byteLength, true);
    view.setUint16(offset + 28, 0, true);     // Extra field length

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

    view.setUint32(offset, 0x02014b50, true); // Central directory signature
    view.setUint16(offset + 4, 20, true);     // Version made by
    view.setUint16(offset + 6, 20, true);     // Version needed to extract
    view.setUint16(offset + 8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(offset + 10, 0, true);     // Compression method (0 = STORE)
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.size, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, entry.nameBytes.byteLength, true);
    view.setUint16(offset + 30, 0, true);     // Extra field length
    view.setUint16(offset + 32, 0, true);     // File comment length
    view.setUint16(offset + 34, 0, true);     // Disk number start
    view.setUint16(offset + 36, 0, true);     // Internal file attributes
    view.setUint32(offset + 38, 0, true);     // External file attributes
    view.setUint32(offset + 42, localOffset, true); // Offset of local header

    offset += 46;
    zipBytes.set(entry.nameBytes, offset);
    offset += entry.nameBytes.byteLength;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(offset, 0x06054b50, true); // EOCD signature
  view.setUint16(offset + 4, 0, true);      // Number of this disk
  view.setUint16(offset + 6, 0, true);      // Disk where central directory starts
  view.setUint16(offset + 8, prepared.length, true);  // Entries on this disk
  view.setUint16(offset + 10, prepared.length, true); // Total entries
  view.setUint32(offset + 12, centralDirSize, true);  // Size of central directory
  view.setUint32(offset + 16, centralDirOffset, true);// Offset of central directory
  view.setUint16(offset + 20, 0, true);     // Comment length

  return zipBytes;
}

// ── Snap-Door SKU & Image Helpers ───────────────────────────────────────────

/** Allowed extensions in Snap-door-api uploadImagesFromZip */
const SNAP_DOOR_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Resolve the normalized SKU for a cart_item object.
 * Snap-door-api requires SKUs matching /^[A-Z0-9_-]{1,64}$/i (uppercase).
 * Uses `item.sku` if present, otherwise `item.product_id`.
 *
 * @param {object} item - Extracted cart_item object
 * @returns {string|null} Uppercase SKU string or null if missing
 */
function resolveItemSku(item) {
  if (!item || typeof item !== "object") return null;
  const rawSku = item.sku !== undefined && item.sku !== null && String(item.sku).trim() !== ""
    ? String(item.sku).trim()
    : item.product_id !== undefined && item.product_id !== null && String(item.product_id).trim() !== ""
      ? String(item.product_id).trim()
      : null;

  if (!rawSku) return null;

  // Sanitize to characters allowed by Snap-door-api (/^[A-Z0-9_-]{1,64}$/)
  const sanitized = rawSku
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return sanitized || null;
}

/**
 * Determine a valid Snap-Door image extension (.jpg, .jpeg, .png, .webp)
 * from the image URL and/or HTTP Content-Type header.
 *
 * @param {string} imageUrl
 * @param {string} [contentType]
 * @returns {string} Extension including leading dot (e.g. ".png")
 */
function resolveImageExtension(imageUrl, contentType = "") {
  // 1. Try URL pathname extension first
  try {
    const pathname = new URL(imageUrl).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = pathname.slice(lastDot).toLowerCase();
      if (SNAP_DOOR_ALLOWED_EXT.has(ext)) {
        return ext;
      }
    }
  } catch (_) {
    // Fallback if URL parsing fails
  }

  // 2. Try Content-Type header
  const mime = (contentType || "").toLowerCase().split(";")[0].trim();
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";

  // 3. Default to .png (accepted by Snap-door-api ALLOWED_EXT)
  return ".png";
}

/**
 * Collect all image URLs associated with a single cart_item.
 * Supports `item.image_url` (Blinkit/Grofers format) and `item.images` / `item.image_urls` arrays.
 *
 * @param {object} item
 * @returns {string[]} Deduplicated array of valid HTTP(S) image URLs
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
 * Tier 1: Fetch image via extension background service worker (bypasses DevTools iframe CORS).
 * @param {string} url
 * @returns {Promise<{ bytes: Uint8Array, contentType: string } | null>}
 */
function fetchImageViaBackground(url) {
  return new Promise(resolve => {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function"
    ) {
      resolve(null);
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, response => {
        if (chrome.runtime.lastError || !response || !response.ok || !response.base64) {
          resolve(null);
          return;
        }
        try {
          const bytes = base64ToUint8Array(response.base64);
          if (bytes.byteLength > 0) {
            resolve({ bytes, contentType: response.contentType || "" });
          } else {
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Tier 2: Check if the image is already cached in DevTools inspectedWindow resources.
 * @param {string} url
 * @returns {Promise<{ bytes: Uint8Array, contentType: string } | null>}
 */
function fetchImageViaDevToolsResource(url) {
  return new Promise(resolve => {
    if (
      typeof chrome === "undefined" ||
      !chrome.devtools ||
      !chrome.devtools.inspectedWindow ||
      typeof chrome.devtools.inspectedWindow.getResources !== "function"
    ) {
      resolve(null);
      return;
    }

    try {
      chrome.devtools.inspectedWindow.getResources(resources => {
        if (!Array.isArray(resources)) {
          resolve(null);
          return;
        }
        const match = resources.find(r => r && r.url === url);
        if (!match || typeof match.getContent !== "function") {
          resolve(null);
          return;
        }
        match.getContent((content, encoding) => {
          if (!content) {
            resolve(null);
            return;
          }
          try {
            if (encoding === "base64") {
              const bytes = base64ToUint8Array(content);
              if (bytes.byteLength > 0) {
                resolve({ bytes, contentType: "" });
                return;
              }
            }
          } catch (_) {
            // Fall through
          }
          resolve(null);
        });
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Multi-tier cross-origin image fetcher:
 *  1. Extension service worker (`FETCH_IMAGE` in background.js)
 *  2. DevTools inspected page resource cache (`chrome.devtools.inspectedWindow.getResources`)
 *  3. Direct `fetch(url)` (when server sends CORS headers or in Node.js)
 *  4. CORS-safe image proxy (`https://wsrv.nl/?url=...`) so it works inside DevTools panel
 *     iframes and standalone HTML pages even when the CDN omits Access-Control-Allow-Origin.
 *
 * @param {string} url
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
async function fetchImageBytes(url) {
  // 1. Try background service worker
  const fromBg = await fetchImageViaBackground(url);
  if (fromBg) return fromBg;

  // 2. Try DevTools inspectedWindow cached resources
  const fromDevTools = await fetchImageViaDevToolsResource(url);
  if (fromDevTools) return fromDevTools;

  // 3. Try direct fetch
  let directError = null;
  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength === 0) {
      throw new Error("Empty image response");
    }
    return { bytes, contentType };
  } catch (err) {
    directError = err;
  }

  // 4. Fallback to CORS-enabled image proxy (wsrv.nl sends Access-Control-Allow-Origin: *)
  try {
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
    const proxyResponse = await fetch(proxyUrl, { credentials: "omit" });
    if (!proxyResponse.ok) {
      throw new Error(`Proxy HTTP ${proxyResponse.status}`);
    }
    const contentType = proxyResponse.headers.get("content-type") || "";
    const arrayBuffer = await proxyResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength === 0) {
      throw new Error("Empty proxy image response");
    }
    return { bytes, contentType };
  } catch (proxyErr) {
    throw directError || proxyErr;
  }
}

/**
 * Download images for all cart_items and package them into a Snap-Door compatible
 * ZIP archive (`{SKU}/main.png`, `{SKU}/image_2.png`, etc.).
 *
 * @param {Array<object>} cartItems - Array of extracted cart_item objects
 * @param {object} [options]
 * @param {number} [options.concurrency=5] - Parallel image fetches
 * @param {function} [options.onProgress] - Callback `({ completed, total, sku }) => void`
 * @returns {Promise<{
 *   zipBytes: Uint8Array,
 *   totalProducts: number,
 *   downloadedProducts: number,
 *   downloadedImages: number,
 *   failed: Array<{ sku: string, url: string, reason: string }>,
 *   skippedWithoutImage: number
 * }>}
 */
async function buildSkuImagesZip(cartItems, options = {}) {
  const concurrency = options.concurrency || 5;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  // Deduplicate products by resolved SKU so we never create duplicate files in the same SKU folder
  const skuTasks = [];
  const seenSkus = new Set();
  let skippedWithoutImage = 0;

  for (const item of cartItems) {
    const sku = resolveItemSku(item);
    if (!sku || seenSkus.has(sku)) continue;

    const urls = extractProductImageUrls(item);
    if (urls.length === 0) {
      skippedWithoutImage++;
      continue;
    }

    seenSkus.add(sku);
    skuTasks.push({ sku, urls, item });
  }

  const zipFiles = [];
  const failed = [];
  let completed = 0;
  let downloadedProducts = 0;

  // Process SKU image downloads with bounded concurrency
  let cursor = 0;
  async function worker() {
    while (cursor < skuTasks.length) {
      const index = cursor++;
      const task = skuTasks[index];
      let productHasImage = false;

      for (let imgIdx = 0; imgIdx < task.urls.length; imgIdx++) {
        const url = task.urls[imgIdx];
        try {
          const { bytes, contentType } = await fetchImageBytes(url);
          const ext = resolveImageExtension(url, contentType);
          const baseName = imgIdx === 0 ? "main" : `image_${imgIdx + 1}`;
          const entryPath = `${task.sku}/${baseName}${ext}`;

          zipFiles.push({ path: entryPath, data: bytes });
          productHasImage = true;
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

  // Sort files by path for deterministic ZIP output
  zipFiles.sort((a, b) => a.path.localeCompare(b.path));

  const zipBytes = zipFiles.length > 0 ? createZipArchive(zipFiles) : new Uint8Array(0);

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
 *
 * @param {Uint8Array} zipBytes
 * @param {string} [filename]
 */
function triggerZipDownload(zipBytes, filename) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const finalName = filename || `sku-images-${timestamp}.zip`;
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
