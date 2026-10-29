# Cart Items Extractor - Quick Start

## What's Been Created

You now have a complete system to extract `cart_item` objects from API responses:

| File | Purpose |
|------|---------|
| `cart-item-extractor.js` | Core extraction logic - pure utility functions |
| `background.js` | Updated with extraction handlers (already integrated) |
| `cart-items-manager.js` | Helper class for easy use in panel.js |
| `CART_ITEMS_GUIDE.md` | Complete documentation |
| `EXAMPLE_INTEGRATION.js` | Step-by-step integration examples |

## What It Does

✅ **Recursively** finds ALL "cart_item" objects at any depth in JSON  
✅ **Preserves** complete object structure with all fields  
✅ **Deduplicates** using product_id field  
✅ **Stores** automatically in background  
✅ **Exports** on demand as JSON  
✅ **Downloads** to file with timestamp  

## Setup (3 Steps)

### Step 1: Update panel.html
Add the manager script:
```html
<script src="cart-items-manager.js"></script>
<script src="panel.js"></script>
```

### Step 2: Initialize in panel.js
```javascript
const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);
```

### Step 3: Extract When Needed
```javascript
// Auto-extract from JSON response
const result = await cartManager.extractFromJson(jsonResponse);
console.log(`Extracted ${result.newItems} items`);

// View all items
const items = await cartManager.getAllCartItems();

// Export
await cartManager.downloadAsFile();
```

## Real Quick Example

In your `onRequestFinished` listener, add:

```javascript
request.getContent((content) => {
  const cartManager = new CartItemsManager(chrome.devtools.inspectedWindowTabId);
  
  cartManager.extractFromJson(content)
    .then(result => {
      if (result.newItems > 0) {
        console.log(`🛒 Found ${result.newItems} cart items!`);
      }
    })
    .catch(err => {});  // Silent fail if no cart items
});
```

That's it! Items are automatically extracted and stored.

## Available Commands

```javascript
// Extract from JSON
await cartManager.extractFromJson(jsonData)
→ { ok, newItems, totalStored, duplicatesDetected }

// Get all items
await cartManager.getAllCartItems()
→ [{ product_id, ...full object... }, ...]

// Clear storage
await cartManager.clearAllCartItems()
→ { ok, itemsCleared }

// Export as JSON string
await cartManager.exportAsJSON()
→ "[{...}, {...}]"

// Download as file
await cartManager.downloadAsFile("filename.json")
→ triggers browser download
```

## How Deduplication Works

**By product_id:**
- If same `product_id` is seen twice → kept once (first occurrence)
- If no `product_id` → always included
- Duplicates tracked and reported

**Example:**
```json
// 3 items in response, but only 2 unique products
[
  { product_id: "A", name: "Widget" },
  { product_id: "A", name: "Widget" },  // ← Duplicate, removed
  { product_id: "B", name: "Gadget" }
]

// Result: 2 items, 1 duplicate detected
```

## For Continuous/Automated Scraping

If you have a **base URL** that serves cart data:

```javascript
async function scrapeApi(baseUrl) {
  const response = await fetch(baseUrl);
  const json = await response.json();
  
  const result = await cartManager.extractFromJson(json);
  console.log(`Scraped ${result.newItems} new items from ${baseUrl}`);
  
  return result;
}

// Call this whenever needed
setInterval(() => {
  scrapeApi("https://api.example.com/cart?user=123");
}, 30000);  // Every 30 seconds
```

## Storage Details

- **Where**: In-memory per tab (background.js)
- **Persistence**: Items cleared when tab closes (auto cleanup)
- **Limit**: RAM limited (depends on system memory)
- **Access**: Get any time with `getAllCartItems()`

## Troubleshooting

**Nothing being extracted?**
- Ensure response has a key named `"cart_item"` somewhere
- Check response is valid JSON
- Look in browser console for errors

**Getting chrome.runtime errors?**
- Verify scripts are loaded in correct order
- Check manifest.json includes background.js
- Restart DevTools (Cmd+Shift+J or F12 close/reopen)

**Performance issues?**
- Large JSON (>10MB) may parse slowly
- Consider filtering by URL pattern before extracting
- Clear old items periodically with `clearAllCartItems()`

## File Locations

All files are in: `e:\NetContext\NetContext.ai\`

```
├── background.js (UPDATED - includes extraction handlers)
├── cart-items-manager.js (NEW - helper class)
├── cart-item-extractor.js (NEW - core logic)
├── CART_ITEMS_GUIDE.md (NEW - full documentation)
├── EXAMPLE_INTEGRATION.js (NEW - integration examples)
├── QUICK_START.md (NEW - this file)
├── panel.js (NO CHANGES REQUIRED - optional integration)
├── panel.html (OPTIONAL - add script tag)
├── manifest.json (NO CHANGES REQUIRED)
└── ... rest of files unchanged
```

## Next Steps

1. **Read** `EXAMPLE_INTEGRATION.js` - Copy code patterns you need
2. **Update** `panel.html` - Add the script tag
3. **Initialize** in `panel.js` - Create CartItemsManager instance
4. **Test** - Open DevTools and trigger API calls
5. **Monitor** console for extraction messages

---

**Questions?** Check `CART_ITEMS_GUIDE.md` for detailed docs.

**Ready to extract!** 🚀
