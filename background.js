/**
 * background.js – Service worker for the NetContext extension.
 *
 * Responsibilities:
 *  - Act as a message relay between the DevTools panel and the inspected page.
 *  - Maintain an in-memory log of captured fetch / XHR requests per tab.
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

// In-memory store: tabId (string) → Array<LogEntry>
const networkLogs = {};

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

// Clean up logs when a tab is closed to avoid memory leaks.
chrome.tabs.onRemoved.addListener(tabId => {
  delete networkLogs[String(tabId)];
});

// Listen for messages from panel.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, tabId, entry } = message;

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

    default:
      sendResponse({ error: "Unknown message type: " + type });
  }

  // Returning true keeps the message channel open for async responses.
  // Not strictly required here (all responses are synchronous) but kept
  // as a safety measure for future async work.
  return true;
});
