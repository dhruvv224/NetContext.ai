/**
 * cart-items-manager.js
 * 
 * Helper module for managing cart item extraction in the DevTools panel.
 * Use this to send extraction requests and retrieve/export cart items.
 */

class CartItemsManager {
  constructor(tabId) {
    this.tabId = tabId;
  }

  /**
   * Extract cart_items from a JSON response.
   * x
   * @param {string|object} jsonData - JSON string or parsed object
   * @returns {Promise<object>} Result with newItems count and totalStored
   * @example
   * const manager = new CartItemsManager(tabId);
   * const result = await manager.extractFromJson(jsonResponse);
   * console.log(`Extracted ${result.newItems} new items, ${result.totalStored} total stored`);
   */
  async extractFromJson(jsonData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "EXTRACT_CART_ITEMS",
          tabId: this.tabId,
          jsonData: jsonData,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * Get all extracted cart items for this tab.
   * 
   * @returns {Promise<Array>} Array of full cart_item objects
   */
  async getAllCartItems() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "GET_CART_ITEMS",
          tabId: this.tabId,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response.cartItems || []);
          }
        }
      );
    });
  }

  /**
   * Clear all extracted cart items from storage.
   * 
   * @returns {Promise<object>} Confirmation with itemsCleared count
   */
  async clearAllCartItems() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "CLEAR_CART_ITEMS",
          tabId: this.tabId,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * Export all cart items as formatted JSON string.
   * 
   * @returns {Promise<string>} Formatted JSON string
   */
  async exportAsJSON() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "EXPORT_CART_ITEMS",
          tabId: this.tabId,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response.exportData);
          }
        }
      );
    });
  }

  /**
   * Download cart items as a JSON file.
   * 
   * @param {string} filename - Optional filename (default: cart-items-{timestamp}.json)
   * @returns {Promise<void>}
   */
  async downloadAsFile(filename) {
    try {
      const jsonString = await this.exportAsJSON();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultFilename = `cart-items-${timestamp}.json`;
      const finalFilename = filename || defaultFilename;

      // Create blob and download link
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = finalFilename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      throw error;
    }
  }
}

// Export for use in other scripts
if (typeof module !== "undefined" && module.exports) {
  module.exports = CartItemsManager;
}
