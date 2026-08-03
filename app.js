const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['*'],
  credentials: true
}));

const IFRAME_BLOCKING_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp'
];

async function handleProxy(req, res) {
  const targetUrl = req.query.url || req.query.u;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing URL parameter',
      usage: '/url?url=https://example.com'
    });
  }

  let decodedUrl;
  try { decodedUrl = decodeURIComponent(targetUrl); }
  catch (e) { decodedUrl = targetUrl; }

  if (!decodedUrl.match(/^https?:\/\//i)) {
    return res.status(400).json({ error: 'Invalid URL. Must start with http:// or https://' });
  }

  try {
    const requestHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': req.headers['referer'] || ''
    };

    if (req.headers.range) requestHeaders['Range'] = req.headers.range;

    const response = await axios({
      method: req.method,
      url: decodedUrl,
      headers: requestHeaders,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      decompress: true
    });

    // ── CORS ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    // ── STRIP IFRAME BLOCKING HEADERS ──
    for (const h of IFRAME_BLOCKING_HEADERS) {
      if (response.headers[h]) {
        console.log(`[STRIP] ${h}: ${response.headers[h]}`);
      }
    }

    // Forward everything EXCEPT iframe-blocking headers
    const skipHeaders = new Set([
      ...IFRAME_BLOCKING_HEADERS,
      'content-encoding', // axios already decompressed
      'transfer-encoding'
    ]);

    for (const [key, value] of Object.entries(response.headers)) {
      if (!skipHeaders.has(key.toLowerCase())) {
        try {
          res.setHeader(key, value);
        } catch (e) {
          // Skip invalid headers
        }
      }
    }

    res.setHeader('X-Proxy-By', 'Express-CORS-Proxy');
    res.setHeader('X-Iframe-Ready', 'yes');

    res.status(response.status);

    if (req.method === 'HEAD') {
      return res.end();
    }

    res.send(response.data);

  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    res.status(500).json({ error: error.message, url: decodedUrl });
  }
}

app.get('/url', handleProxy);
app.head('/url', handleProxy);
app.options('/url', cors());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', features: ['cors-bypass', 'iframe-bypass'] });
});

app.get('/', (req, res) => {
  res.json({
    name: 'X-Frame Stripper + CORS Proxy',
    usage: '/url?url=https://example.com',
    features: ['Strips X-Frame-Options', 'Strips CSP frame-ancestors', 'Adds CORS headers']
  });
});

app.options('*', cors());

module.exports = app;
