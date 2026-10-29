# Cart Items Extractor - Usage Guide

This guide explains how to use the cart item extraction system in your NetContext extension.

## Overview

The system consists of three parts:

1. **cart-item-extractor.js** - Low-level extraction logic (pure utility functions)
2. **background.js** - Service worker with message handlers and persistent storage
3. **cart-items-manager.js** - Helper class for easy integration in the DevTools panel

## Quick Start

### In Your DevTools Panel (panel.js)

```javascript
// 1. Create a manager instance for the current tab
const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);

// 2. When you capture an API response with cart_items, extract them:
const result = await cartManager.extractFromJson(responseBody);
console.log(`Extracted ${result.newItems} new items`);
console.log(`Total stored: ${result.totalStored}`);

// 3. Get all extracted items
const allItems = await cartManager.getAllCartItems();
console.log(allItems);  // Array of full cart_item objects

// 4. Export to JSON
const jsonString = await cartManager.exportAsJSON();
console.log(jsonString);

// 5. Download to file
await cartManager.downloadAsFile("my-cart-items.json");
```

## Usage Patterns

### Pattern 1: Automatic Extraction from Logged Requests

When you capture fetch/XHR requests in panel.js, extract from responses automatically:

```javascript
// In panel.js, after capturing a request:
chrome.devtools.network.onRequestFinished.addListener(async (request) => {
  // ... existing code to parse request ...
  
  // Parse response body
  if (request.response.status === 200) {
    request.getContent((content) => {
      const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);
      
      // Silently extract cart items in background
      cartManager.extractFromJson(content)
        .then(result => {
          if (result.newItems > 0) {
            console.log(`Extracted ${result.newItems} cart items`);
          }
        })
        .catch(err => console.error("Extraction failed:", err));
    });
  }
});
```

### Pattern 2: Manual Extraction on Button Click

Add a button in your panel.html to extract from current response:

```html
<!-- In panel.html -->
<button id="extract-btn">Extract Cart Items from Selected Response</button>
```

```javascript
// In panel.js
document.getElementById("extract-btn").addEventListener("click", async () => {
  const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);
  
  // Get selected log entry (you would get this from your UI)
  const selectedLogEntry = getSelectedLog();  // Your function
  
  if (selectedLogEntry && selectedLogEntry.responseBody) {
    try {
      const result = await cartManager.extractFromJson(selectedLogEntry.responseBody);
      alert(`Extracted ${result.newItems} items (${result.totalStored} total)`);
    } catch (error) {
      alert("Error: " + error.message);
    }
  }
});
```

### Pattern 3: Continuous Background Scraping (Multiple APIs)

If you want to continuously scrape cart items from multiple API endpoints:

```javascript
// In panel.js or a background script
const cartManager = new CartItemsManager(tabId);
const apiEndpoints = [
  "https://api.example.com/cart",
  "https://api.example.com/checkout/items",
  "https://shop.example.com/api/basket"
];

async function continuousScrape(intervalMs = 30000) {
  setInterval(async () => {
    for (const endpoint of apiEndpoints) {
      try {
        const response = await fetch(endpoint);
        const json = await response.json();
        
        const result = await cartManager.extractFromJson(json);
        if (result.newItems > 0) {
          console.log(`[${new Date().toISOString()}] Got ${result.newItems} new items from ${endpoint}`);
        }
      } catch (error) {
        console.error(`Failed to scrape ${endpoint}:`, error);
      }
    }
  }, intervalMs);
}

// Start scraping every 30 seconds
continuousScrape(30000);
```

### Pattern 4: Extract and Filter by Base URL

Extract items but only from responses matching a specific base URL:

```javascript
const cartManager = new CartItemsManager(tabId);

async function extractFromUrlMatching(logs, baseUrlPattern) {
  const results = [];
  
  for (const log of logs) {
    // Filter by URL pattern
    if (!log.url.includes(baseUrlPattern)) {
      continue;
    }
    
    // Extract from matching responses
    try {
      const result = await cartManager.extractFromJson(log.responseBody);
      results.push({
        url: log.url,
        items: result.cartItems,
        count: result.count,
      });
    } catch (error) {
      console.error(`Extraction failed for ${log.url}:`, error);
    }
  }
  
  return results;
}

// Usage:
const matchingResults = await extractFromUrlMatching(logs, "api.example.com/cart");
```

## Message Protocol (Low-level)

If you need to use the background.js message handlers directly:

### Extract from JSON

```javascript
chrome.runtime.sendMessage(
  {
    type: "EXTRACT_CART_ITEMS",
    tabId: tabId,
    jsonData: jsonObject,  // or JSON string
  },
  (response) => {
    console.log(response);
    // { ok: true, newItems: 3, totalStored: 15, duplicatesDetected: 1 }
  }
);
```

### Get All Cart Items

```javascript
chrome.runtime.sendMessage(
  {
    type: "GET_CART_ITEMS",
    tabId: tabId,
  },
  (response) => {
    console.log(response.cartItems);  // Array of cart_item objects
  }
);
```

### Clear Cart Items

```javascript
chrome.runtime.sendMessage(
  {
    type: "CLEAR_CART_ITEMS",
    tabId: tabId,
  },
  (response) => {
    console.log(`Cleared ${response.itemsCleared} items`);
  }
);
```

### Export Cart Items

```javascript
chrome.runtime.sendMessage(
  {
    type: "EXPORT_CART_ITEMS",
    tabId: tabId,
  },
  (response) => {
    const jsonString = response.exportData;  // Formatted JSON
    console.log(jsonString);
  }
);
```

## Extraction Logic Details

### How It Works

1. **Recursive Traversal**: The extractor recursively walks through all objects and arrays in the JSON
2. **Detection**: Finds every occurrence of a `"cart_item"` key (at any depth)
3. **Full Preservation**: Keeps the complete object with all nested properties, no filtering
4. **Deduplication**: Removes duplicates using `product_id` field
   - If an item has no `product_id`, it's always included (can't deduplicate)
   - If `product_id` is seen before, it's skipped

### Example

Given this JSON:

```json
{
  "user": { "name": "John" },
  "cart": {
    "items": [
      {
        "cart_item": {
          "product_id": "SKU-001",
          "name": "Widget",
          "price": 29.99
        }
      }
    ]
  },
  "related": {
    "suggestions": [
      {
        "cart_item": {
          "product_id": "SKU-001",
          "name": "Widget",
          "price": 29.99
        }
      },
      {
        "cart_item": {
          "product_id": "SKU-002",
          "name": "Gadget",
          "price": 49.99,
          "nested": { "deep": "value" }
        }
      }
    ]
  }
}
```

The extractor will return:

```json
[
  {
    "product_id": "SKU-001",
    "name": "Widget",
    "price": 29.99
  },
  {
    "product_id": "SKU-002",
    "name": "Gadget",
    "price": 49.99,
    "nested": { "deep": "value" }
  }
]
```

Note: The duplicate `SKU-001` is removed.

## Integration with Your Panel

### Update panel.html

Add these script tags to include the managers:

```html
<!DOCTYPE html>
<html>
<head>
  <title>NetContext DevTools</title>
</head>
<body>
  <!-- Your existing elements -->
  
  <script src="cart-items-manager.js"></script>
  <script src="panel.js"></script>
</body>
</html>
```

### Update Your Capture Logic

In panel.js, modify the request capture to automatically extract:

```javascript
chrome.devtools.network.onRequestFinished.addListener((request) => {
  const resourceType = request._resourceType || request.resourceType;
  if (resourceType !== "fetch" && resourceType !== "xhr") {
    return;
  }

  // ... existing code to build reqHeaders, resHeaders ...

  // NEW: Auto-extract cart items from response
  request.getContent((content) => {
    if (content && request.response.status === 200) {
      const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);
      cartManager.extractFromJson(content).catch(err => {
        // Silent fail - not all responses will have cart items
      });
    }
  });

  // ... continue with existing ADD_LOG logic ...
});
```

## Performance Notes

- **Memory**: All extracted items are stored in memory per tab
- **Cleanup**: Items are automatically cleared when a tab closes
- **Large Responses**: For very large JSON (>10MB), parsing may be slow
- **Background Processing**: Use batch extraction for multiple APIs

## Troubleshooting

### "Invalid JSON" Error

Make sure you're passing valid JSON:

```javascript
// Good - Pass object
const manager = new CartItemsManager(tabId);
await manager.extractFromJson({ cart_item: {...} });

// Good - Pass JSON string
await manager.extractFromJson('{"cart_item": {...}}');

// Bad - Invalid JSON string
await manager.extractFromJson('{broken json}');
```

### Chrome Extension Errors

If you get "chrome.runtime.lastError":

1. Ensure background.js is properly registered in manifest.json
2. Check DevTools console for errors
3. Verify tabId is correct

### Items Not Being Extracted

1. Check that the response has a `cart_item` key somewhere
2. Verify the response is valid JSON
3. Check browser console for parsing errors

## API Reference

### CartItemsManager

```javascript
class CartItemsManager {
  constructor(tabId: number);
  
  extractFromJson(jsonData: string | object): Promise<{
    ok: boolean,
    newItems: number,
    totalStored: number,
    duplicatesDetected: number
  }>;
  
  getAllCartItems(): Promise<Array>;
  clearAllCartItems(): Promise<{ ok: boolean, itemsCleared: number }>;
  exportAsJSON(): Promise<string>;
  downloadAsFile(filename?: string): Promise<void>;
}
```

### Utility Functions (in background.js)

```javascript
extractCartItems(jsonInput: string | object): {
  cartItems: Array,
  count: number,
  duplicates: number,
  timestamp: string,
  error?: string
};

traverseAndExtract(data, seenIds?: Set, results?: Array): Array;
countCartItemsInJson(data): number;
```

---

**Ready to use!** Start extracting cart items from your network traffic!
