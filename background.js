/**
 * background.js – Service worker for the NetContext extension.
 *
 * Responsibilities:
 *  - Act as a message relay between the DevTools panel and the inspected page.
 *  - Maintain an in-memory log of captured fetch / XHR requests per tab.
 *  - Extract cart_item objects from API responses in background.
 *
 * Data flow:
 *  panel.js  →  chrome.runtime.sendMessage  →  background.js  →  panel.js
 *
 * Log entry shape:
 * {
 *   url:             string,
 *   method:          string,
 *   status:          number,
 *   requestHeaders:  object,
 *   responseHeaders: object,
 *   responseBody:    string | null,
 *   timestamp:       string   (ISO-8601)
 * }
 */

// ──────────────────────────────────────────────────────────────────────────────
// CART ITEM EXTRACTION UTILITY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recursively traverse JSON and collect all cart_item objects.
 */
function traverseAndExtract(data, seenIds = new Set(), results = []) {
  if (data === null || data === undefined) {
    return results;
  }

  if (Array.isArray(data)) {
    data.forEach(item => traverseAndExtract(item, seenIds, results));
    return results;
  }

  if (typeof data === "object") {
    // Check if this object has a valid cart_item property
    if (
      Object.prototype.hasOwnProperty.call(data, "cart_item") &&
      data.cart_item !== null &&
      typeof data.cart_item === "object"
    ) {
      const cartItem = data.cart_item;
      const productId = cartItem.product_id;
      
      if (productId !== undefined && !seenIds.has(productId)) {
        seenIds.add(productId);
        results.push(cartItem);
      } else if (productId === undefined) {
        // Add items without product_id (can't deduplicate)
        results.push(cartItem);
      }
    }

    // Continue traversing all properties
    Object.values(data).forEach(value => {
      traverseAndExtract(value, seenIds, results);
    });
  }

  return results;
}

/**
 * Extract all cart_item objects from JSON with deduplication.
 */
function extractCartItems(jsonInput) {
  let data;

  try {
    if (typeof jsonInput === "string") {
      data = JSON.parse(jsonInput);
    } else {
      data = jsonInput;
    }
  } catch (error) {
    return {
      error: "Invalid JSON: " + error.message,
      cartItems: [],
      count: 0,
      duplicates: 0,
    };
  }

  const seenIds = new Set();
  const cartItems = traverseAndExtract(data, seenIds);
  const totalBefore = countCartItemsInJson(data);
  const duplicatesRemoved = Math.max(0, totalBefore - cartItems.length);

  return {
    cartItems: cartItems,
    count: cartItems.length,
    duplicates: duplicatesRemoved,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Count total cart_item occurrences in JSON (before deduplication).
 */
function countCartItemsInJson(data, count = 0) {
  if (data === null || data === undefined) {
    return count;
  }

  if (Array.isArray(data)) {
    return data.reduce((sum, item) => sum + countCartItemsInJson(item), count);
  }

  if (typeof data === "object") {
    if (
      Object.prototype.hasOwnProperty.call(data, "cart_item") &&
      data.cart_item !== null &&
      typeof data.cart_item === "object"
    ) {
      count++;
    }
    return Object.values(data).reduce(
      (sum, value) => sum + countCartItemsInJson(value),
      count
    );
  }

  return count;
}

// In-memory store: tabId (string) → Array<LogEntry>
const networkLogs = {};
// Store for extracted cart items: tabId (string) → Array<CartItem>
const extractedCartItems = {};

/**
 * Return the log array for a given tab, creating it if necessary.
 * @param {number|string} tabId
 * @returns {Array}
 */
function getLogsForTab(tabId) {
  const key = String(tabId);
  if (!networkLogs[key]) {
    networkLogs[key] = [];
  }
  return networkLogs[key];
}

// Clean up logs and extracted items when a tab is closed to avoid memory leaks.
chrome.tabs.onRemoved.addListener(tabId => {
  delete networkLogs[String(tabId)];
  delete extractedCartItems[String(tabId)];
});

// Listen for messages from panel.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, tabId, entry, jsonData } = message;

  switch (type) {
    // panel.js asks for all logs for a tab
    case "GET_LOGS": {
      sendResponse({ logs: getLogsForTab(tabId) });
      break;
    }

    // panel.js reports a newly captured network entry
    case "ADD_LOG": {
      getLogsForTab(tabId).push(entry);
      sendResponse({ ok: true, count: getLogsForTab(tabId).length });
      break;
    }

    // panel.js requests the log list to be cleared for a tab
    case "CLEAR_LOGS": {
      networkLogs[String(tabId)] = [];
      sendResponse({ ok: true });
      break;
    }

    // Extract cart_item from response body
    case "EXTRACT_CART_ITEMS": {
      const result = extractCartItems(jsonData);
      
      const tabIdKey = String(tabId);
      if (!extractedCartItems[tabIdKey]) {
        extractedCartItems[tabIdKey] = [];
      }
      
      // Add newly extracted items, checking for duplicates against storage
      const seenIds = new Set(
        extractedCartItems[tabIdKey].map(item => item.product_id)
      );
      
      result.cartItems.forEach(item => {
        if (item.product_id && !seenIds.has(item.product_id)) {
          seenIds.add(item.product_id);
          extractedCartItems[tabIdKey].push(item);
        }
      });
      
      sendResponse({
        ok: true,
        newItems: result.count,
        totalStored: extractedCartItems[tabIdKey].length,
        duplicatesDetected: result.duplicates,
      });
      break;
    }

    // Get all extracted cart items for a tab
    case "GET_CART_ITEMS": {
      const tabIdKey = String(tabId);
      sendResponse({
        cartItems: extractedCartItems[tabIdKey] || [],
        count: (extractedCartItems[tabIdKey] || []).length,
      });
      break;
    }

    // Clear cart items for a tab
    case "CLEAR_CART_ITEMS": {
      const tabIdKey = String(tabId);
      const cleared = (extractedCartItems[tabIdKey] || []).length;
      extractedCartItems[tabIdKey] = [];
      sendResponse({
        ok: true,
        itemsCleared: cleared,
      });
      break;
    }

    // Export all cart items as JSON
    case "EXPORT_CART_ITEMS": {
      const tabIdKey = String(tabId);
      const items = extractedCartItems[tabIdKey] || [];
      sendResponse({
        ok: true,
        exportData: JSON.stringify(items, null, 2),
        count: items.length,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    default:
      sendResponse({ error: "Unknown message type: " + type });
  }

  return true;
});
