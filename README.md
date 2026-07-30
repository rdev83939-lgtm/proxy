# CORS Proxy — Vercel Deploy

Express.js proxy deployed as a Vercel serverless function. Bypasses CORS, strips iframe-blocking headers, filters ads, and rewrites URLs.

## Quick Deploy

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Deploy
```bash
cd cors-proxy-vercel
vercel --prod
```

Or push to GitHub and import into [vercel.com](https://vercel.com).

## Local Dev
```bash
npm install
npm start        # runs on :5000
npm run dev      # with nodemon
```

## Usage

```
https://your-project.vercel.app/url?url=https://example.com/page.html
```

### In an iframe
```html
<iframe src="https://your-project.vercel.app/url?url=https://example.com" width="100%" height="600"></iframe>
```

### Query params
| Param | Description |
|-------|-------------|
| `?url=` | Target URL to proxy |
| `&raw=1` | No filtering, no rewriting |
| `&norewrite=1` | Ad filter on, but no URL rewriting |

## ⚠️ Vercel Limits

| Limit | Hobby | Pro |
|-------|-------|-----|
| Function timeout | 10s | 60s |
| Max response size | 4.5 MB | 100 MB |
| Cold start | ~100-500ms | ~100-500ms |

For heavy proxying (large video files, slow sites), consider **Railway**, **Render**, or a VPS instead.
