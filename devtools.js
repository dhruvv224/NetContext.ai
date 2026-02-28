/**
 * devtools.js – Registers the NetContext panel inside Chrome DevTools.
 *
 * This script runs in the DevTools context (not in the inspected page).
 * It creates a single panel entry "NetContext" that loads panel.html.
 */

chrome.devtools.panels.create(
  "NetContext",          // Panel tab title
  "",                    // Icon path (empty = no icon)
  "panel.html",          // HTML page rendered inside the panel
  function (panel) {
    // panel is a DevToolsPanel object – reserved for future use
    // (e.g. panel.onShown / panel.onHidden listeners).
    void panel;
  }
);
