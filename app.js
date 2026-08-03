const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'], allowedHeaders: ['*'] }));

async function handleProxy(req, res) {
  const targetUrl = req.query.url || req.query.u;
  if (!targetUrl) return res.status(400).json({ error: 'Missing ?url=' });

  let decodedUrl;
  try { decodedUrl = decodeURIComponent(targetUrl); }
  catch (e) { decodedUrl = targetUrl; }

  if (!decodedUrl.match(/^https?:\/\//i)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await axios({
      method: req.method,
      url: decodedUrl,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Range': req.headers['range'] || undefined,
        'Referer': req.headers['referer'] || ''
      },
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      decompress: true
    });

    res.setHeader('Access-Control-Allow-Origin', '*');

    // Forward all headers EXCEPT x-frame-options
    for (const [key, value] of Object.entries(response.headers)) {
      const lower = key.toLowerCase();
      if (lower !== 'x-frame-options' && lower !== 'content-encoding' && lower !== 'transfer-encoding') {
        try { res.setHeader(key, value); } catch (e) {}
      }
    }

    res.status(response.status);
    if (req.method === 'HEAD') return res.end();
    res.send(response.data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.get('/url', handleProxy);
app.head('/url', handleProxy);
app.options('/url', cors());
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ usage: '/url?url=https://example.com' }));
app.options('*', cors());

module.exports = app;
