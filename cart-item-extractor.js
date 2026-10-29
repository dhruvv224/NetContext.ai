/**
 * cart-item-extractor.js
 * 
 * Utility to recursively extract all "cart_item" objects from deeply nested JSON.
 * Features:
 *  - Traverses all nested objects and arrays
 *  - Removes duplicates based on product_id
 *  - Returns full unmodified objects
 *  - Preserves all nested properties
 */

/**
 * Recursively traverse JSON and collect all cart_item objects.
 * @param {any} data - The data to traverse (object, array, or primitive)
 * @param {Set} seenIds - Set of product_ids already collected (for deduplication)
 * @param {Array} results - Array to accumulate cart_item objects
 */
function traverseAndExtract(data, seenIds = new Set(), results = []) {
  // Handle null or undefined
  if (data === null || data === undefined) {
    return results;
  }

  // If it's an array, process each element
  if (Array.isArray(data)) {
    data.forEach(item => traverseAndExtract(item, seenIds, results));
    return results;
  }

  // If it's an object, check each property
  if (typeof data === "object") {
    // Check if this object has a valid cart_item object
    if (
      Object.prototype.hasOwnProperty.call(data, "cart_item") &&
      data.cart_item !== null &&
      typeof data.cart_item === "object"
    ) {
      const cartItem = data.cart_item;
      
      // Check for duplicates using product_id
      const productId = cartItem.product_id;
      if (productId !== undefined && !seenIds.has(productId)) {
        seenIds.add(productId);
        results.push(cartItem);
      } else if (productId === undefined) {
        // If no product_id, add it anyway (can't deduplicate)
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
 * Main extraction function.
 * 
 * @param {string|object} jsonInput - JSON string or parsed object
 * @returns {object} Result object with extracted cart_items and metadata
 */
function extractCartItems(jsonInput) {
  let data;

  try {
    // Parse if it's a string
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
  let totalBefore = countCartItemsInJson(data);

  // Fallback: if input is already an array of extracted product objects (with product_id + image_url/product_name)
  if (cartItems.length === 0 && Array.isArray(data)) {
    for (const item of data) {
      if (
        item &&
        typeof item === "object" &&
        item.product_id !== undefined &&
        (item.image_url !== undefined || item.product_name !== undefined || item.display_name !== undefined)
      ) {
        totalBefore++;
        if (!seenIds.has(item.product_id)) {
          seenIds.add(item.product_id);
          cartItems.push(item);
        }
      }
    }
  }

  const duplicatesRemoved = Math.max(0, totalBefore - cartItems.length);

  return {
    cartItems: cartItems,
    count: cartItems.length,
    duplicates: duplicatesRemoved,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper: Count total cart_item occurrences in JSON (before deduplication).
 * @param {any} data
 * @returns {number}
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

/**
 * Batch process multiple JSON responses.
 * Combines cart_items from all sources into a single deduplicated array.
 * 
 * @param {array} jsonResponses - Array of JSON strings or objects
 * @returns {object} Combined result with all unique cart_items
 */
function extractCartItemsFromBatch(jsonResponses) {
  const allItems = [];
  const seenIds = new Set();
  let totalDuplicates = 0;
  const sourceCount = jsonResponses.length;

  jsonResponses.forEach((jsonInput, index) => {
    const result = extractCartItems(jsonInput);
    
    if (result.error) {
      console.warn(`[Batch Index ${index}] ${result.error}`);
      return;
    }

    totalDuplicates += result.duplicates || 0;

    result.cartItems.forEach(item => {
      const productId = item.product_id;
      if (productId !== undefined && !seenIds.has(productId)) {
        seenIds.add(productId);
        allItems.push(item);
      } else if (productId === undefined) {
        allItems.push(item);
      } else {
        totalDuplicates++;
      }
    });
  });

  return {
    cartItems: allItems,
    count: allItems.length,
    sourcesProcessed: sourceCount,
    duplicates: totalDuplicates,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Export for use in Node.js or browser environments.
 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extractCartItems,
    extractCartItemsFromBatch,
    traverseAndExtract,
  };
}
