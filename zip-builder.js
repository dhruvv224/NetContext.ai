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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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

function resolveImageExtension(imageUrl, contentType = "") {
  // The response type wins: CDNs often serve WEBP from a URL ending in .png.
  const mime = (contentType || "").toLowerCase().split(";")[0].trim();
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";

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

  return ".png";
}

/**
 * Turn a Cloudflare resize URL (https://cdn.grofers.com/cdn-cgi/image/f=auto,w=270/<path>)
 * into the original asset URL. The resize endpoint sends no CORS headers, so fetching it
 * always fails; the original is CORS-enabled for blinkit.com and full resolution.
 *
 * @param {string} url
 * @returns {string}
 */
function originalImageUrl(url) {
  return url.replace(/\/cdn-cgi\/image\/[^/]+\//, "/");
}

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

  return [...new Set(urls.map(originalImageUrl))];
}

const IMAGE_FETCH_TIMEOUT_MS = 20000;

/**
 * Fetch one product image directly from its CDN.
 * The DevTools panel runs this inside the inspected Blinkit tab, because
 * cdn.grofers.com only sends CORS headers for https://blinkit.com.
 *
 * @param {string} url
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
async function fetchImageBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      signal: controller.signal,
      // Prefer formats Snap-door-api accepts over AVIF when the CDN negotiates.
      headers: { Accept: "image/webp,image/png,image/jpeg,image/*;q=0.8" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/^image\//i.test(contentType)) {
      throw new Error(`Not an image (${contentType.split(";")[0]})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Empty image response");
    }
    return { bytes, contentType };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Timed out after ${IMAGE_FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download images for all cart_items and package them into a Snap-Door compatible
 * ZIP archive (`{SKU}/main.png`, `{SKU}/image_2.png`, etc.).
 */
async function buildSkuImagesZip(cartItems, options = {}) {
  const concurrency = options.concurrency || 6;
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
          const { bytes, contentType } = await fetchImageBytes(url);
          const ext = resolveImageExtension(url, contentType);
          const baseName = imgIdx === 0 ? "main" : `image_${imgIdx + 1}`;
          const entryPath = `${task.sku}/${baseName}${ext}`;

          zipFiles.push({ path: entryPath, data: bytes });
          productHasImage = true;
          log(`✓ [${completed + 1}/${skuTasks.length}] ${entryPath} (${(bytes.byteLength / 1024).toFixed(1)} KB)`, "success");
        } catch (err) {
          const reason = err && err.message ? err.message : String(err);
          failed.push({ sku: task.sku, url, reason });
          log(`❌ ${task.sku}: ${url} -> ${reason}`, "error");
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
  log(`ZIP archive ready: ${(zipBytes.byteLength / 1024 / 1024).toFixed(2)} MB (${zipBytes.byteLength} bytes).`);

  return {
    zipBytes,
    totalProducts: skuTasks.length,
    downloadedProducts,
    downloadedImages: zipFiles.length,
    failed,
    skippedWithoutImage,
  };
}

/** Default archive name, e.g. sku-images-2026-10-30T10-15-00.zip */
function defaultZipFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `sku-images-${timestamp}.zip`;
}

/**
 * Save a ZIP from a normal web page: the inspected tab (via panel.js) or test-extractor.html.
 *
 * @param {Uint8Array} zipBytes
 * @param {string} [filename]
 */
function triggerZipDownload(zipBytes, filename) {
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultZipFileName();
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
    originalImageUrl,
    extractProductImageUrls,
    fetchImageBytes,
    buildSkuImagesZip,
    defaultZipFileName,
    triggerZipDownload,
  };
}
