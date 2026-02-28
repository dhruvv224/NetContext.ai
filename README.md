# NetContext.ai
# NetContext

Export your Chrome DevTools Network tab as AI-ready structured JSON.

NetContext is a lightweight Chrome DevTools extension that captures `fetch` and `XHR` requests and allows developers to copy formatted runtime logs instantly.

---

## 🚀 Why NetContext?

AI coding tools can see your code — but they can’t see your runtime network activity.

When debugging API issues, developers constantly switch between:

- DevTools Network tab
- Backend logs
- Code editor
- AI assistant

NetContext bridges that gap by letting you export structured network logs in one click.

---

## ✨ Features (v0.1)

- ✅ Captures `fetch` and `XHR` requests only  
- ✅ Excludes images, CSS, fonts, and static assets  
- ✅ Stores logs in memory  
- ✅ One-click **Copy JSON Logs**  
- ✅ Pretty-printed structured JSON  
- ✅ Lightweight and local-only  

No backend.  
No tracking.  
No external API calls.

---

## 📦 What Data Is Captured?

For each request:

- `url`
- `method`
- `status`
- `requestHeaders`
- `responseHeaders`
- `responseBody` (if available)
- `timestamp`

All logs remain local in the DevTools session.

---

## 🛠 Installation (Development Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/netcontext.git
