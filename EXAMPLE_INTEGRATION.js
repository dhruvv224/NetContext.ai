/**
 * EXAMPLE: How to integrate cart item extraction into panel.js
 * 
 * This file shows the minimal changes needed to add cart extraction to your existing panel.js
 */

// ──────────────────────────────────────────────────────────────────────────────
// IN YOUR panel.js, ADD THIS CODE:
// ──────────────────────────────────────────────────────────────────────────────

// 1. Create a manager instance for the current tab
const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);

// ──────────────────────────────────────────────────────────────────────────────
// 2. MODIFY THE onRequestFinished LISTENER (in panel.js)
// ──────────────────────────────────────────────────────────────────────────────

// Modify your existing chrome.devtools.network.onRequestFinished listener:

// BEFORE (your current code):
/*
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

  // Parse response content
  request.getContent((content) => {
    const entry = {
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      requestHeaders: reqHeaders,
      responseHeaders: resHeaders,
      responseBody: content,
      timestamp: new Date().toISOString(),
    };

    chrome.runtime.sendMessage(
      {
        type: "ADD_LOG",
        tabId: chrome.devtools.inspectedWindowTabId,
        entry: entry,
      },
      (response) => {
        if (!response.ok) {
          console.error("Failed to log request:", response.error);
        }
      }
    );
  });
});
*/

// AFTER (with cart item extraction):
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

  // Parse response content
  request.getContent((content) => {
    // ─────────────────────────────────────────────────────────────────────────
    // NEW: TRY TO EXTRACT CART ITEMS FROM THIS RESPONSE
    // ─────────────────────────────────────────────────────────────────────────
    if (content && request.response.status === 200) {
      // Try to extract cart items in the background (non-blocking)
      cartManager.extractFromJson(content)
        .then(result => {
          if (result.newItems > 0) {
            console.log(
              `🛒 Extracted ${result.newItems} cart items from ${request.request.url}`
            );
          }
        })
        .catch(err => {
          // Silent fail - not all responses will have cart items
          // Only log if it's a real error (not just "no cart items found")
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXISTING: CONTINUE LOGGING THE REQUEST
    // ─────────────────────────────────────────────────────────────────────────
    const entry = {
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      requestHeaders: reqHeaders,
      responseHeaders: resHeaders,
      responseBody: content,
      timestamp: new Date().toISOString(),
    };

    chrome.runtime.sendMessage(
      {
        type: "ADD_LOG",
        tabId: chrome.devtools.inspectedWindowTabId,
        entry: entry,
      },
      (response) => {
        if (!response.ok) {
          console.error("Failed to log request:", response.error);
        }
      }
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. OPTIONAL: ADD UI BUTTONS FOR MANUAL EXTRACTION
// ──────────────────────────────────────────────────────────────────────────────

// In your panel.html, add these buttons:
/*
<button id="view-cart-items">📊 View Cart Items</button>
<button id="export-cart-items">💾 Export as JSON</button>
<button id="clear-cart-items">🗑️ Clear Cart Items</button>
*/

// In panel.js, add these handlers:
document.getElementById("view-cart-items")?.addEventListener("click", async () => {
  try {
    const items = await cartManager.getAllCartItems();
    if (items.length === 0) {
      alert("No cart items extracted yet");
      return;
    }
    
    console.table(items);
    alert(`Found ${items.length} unique cart items. See console for details.`);
  } catch (error) {
    alert("Error: " + error.message);
  }
});

document.getElementById("export-cart-items")?.addEventListener("click", async () => {
  try {
    await cartManager.downloadAsFile();
    alert("Cart items exported successfully!");
  } catch (error) {
    alert("Export failed: " + error.message);
  }
});

document.getElementById("clear-cart-items")?.addEventListener("click", async () => {
  if (!confirm("Clear all extracted cart items?")) {
    return;
  }
  
  try {
    const result = await cartManager.clearAllCartItems();
    alert(`Cleared ${result.itemsCleared} items`);
  } catch (error) {
    alert("Clear failed: " + error.message);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. OPTIONAL: FILTER EXTRACTION BY BASE URL
// ──────────────────────────────────────────────────────────────────────────────

// If you want to extract only from specific API endpoints:

const CART_API_PATTERNS = [
  "api.example.com/cart",
  "api.example.com/checkout",
  "shop.example.com/api/items",
  // Add your API endpoints
];

function isCartApiUrl(url) {
  return CART_API_PATTERNS.some(pattern => url.includes(pattern));
}

// Then in the onRequestFinished listener, add a check:
if (content && request.response.status === 200 && isCartApiUrl(request.request.url)) {
  cartManager.extractFromJson(content).catch(err => {
    // Silent fail
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. OPTIONAL: AUTO-REFRESH UI WITH EXTRACTED ITEMS COUNT
// ──────────────────────────────────────────────────────────────────────────────

// Update a counter in your panel
async function updateCartItemsCount() {
  const items = await cartManager.getAllCartItems();
  const countEl = document.getElementById("cart-items-count");
  if (countEl) {
    countEl.textContent = items.length;
    countEl.style.display = items.length > 0 ? "inline" : "none";
  }
}

// Call this periodically or after each extraction
// setInterval(updateCartItemsCount, 5000);  // Every 5 seconds

// Or call it after successful extraction:
cartManager.extractFromJson(content)
  .then(result => {
    if (result.newItems > 0) {
      updateCartItemsCount();
    }
  })
  .catch(err => {
    // Silent fail
  });

// ──────────────────────────────────────────────────────────────────────────────
// 6. OPTIONAL: STRUCTURED DATA LOGGING
// ──────────────────────────────────────────────────────────────────────────────

// If you want detailed logs of what was extracted:

const extractionLog = [];

cartManager.extractFromJson(content)
  .then(result => {
    if (result.newItems > 0) {
      extractionLog.push({
        timestamp: new Date().toISOString(),
        url: request.request.url,
        newItems: result.newItems,
        totalStored: result.totalStored,
        duplicates: result.duplicatesDetected,
      });
      
      console.log("Extraction Log:", extractionLog);
    }
  })
  .catch(err => {
    // Silent fail
  });

// ──────────────────────────────────────────────────────────────────────────────
// THAT'S IT!
// ──────────────────────────────────────────────────────────────────────────────
// Now whenever a network request is captured:
// 1. It's logged to the table (existing behavior)
// 2. If it contains cart_items, they're automatically extracted
// 3. You can view/export them at any time
// 4. Duplicates are automatically removed
// 5. All fields are preserved exactly as they appear in the JSON
