const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const url = require('url');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['*'],
  credentials: true
}));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ── AD CONFIG (conservative) ──
const AD_DOMAINS = [
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'google-analytics.com',
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'securepubads.g.doubleclick.net',
  'pubads.g.doubleclick.net',
  'amazon-adsystem.com',
  'advertising.com',
  'adsrvr.org',
  'adnxs.com',
  'rubiconproject.com',
  'openx.net',
  'pubmatic.com',
  'criteo.com',
  'outbrain.com',
  'taboola.com',
  'revcontent.com',
  'mgid.com',
  'adroll.com',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'facebook.com/tr',
  'connect.facebook.net'
];

const HTML_AD_SELECTORS = [
  'ins.adsbygoogle',
  'script[src*="googlesyndication.com"]',
  'script[src*="doubleclick.net"]',
  'script[src*="googleadservices.com"]',
  'script[src*="google-analytics.com"]',
  'script[src*="pagead2"]',
  'script[src*="connect.facebook.net"]',
  'script[src*="facebook.com/tr"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googleadservices.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="outbrain.com"]',
  'iframe[src*="taboola.com"]'
];

const IFRAME_BLOCKING_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp'
];

// ── HELPERS ──
function isAdUrl(targetUrl) {
  try {
    const parsed = new url.URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();
    for (const adDomain of AD_DOMAINS) {
      if (hostname === adDomain || hostname.endsWith('.' + adDomain)) return true;
    }
    return false;
  } catch (e) { return false; }
}

function resolveUrl(href, base) {
  try {
    if (!href || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('javascript:')) return href;
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    return new url.URL(href, base).href;
  } catch (e) { return href; }
}

function proxyUrl(href, proxyBase) {
  if (!href || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('javascript:')) return href;
  if (href.includes('/url?url=') || href.includes('/url?u=')) return href;
  return `${proxyBase}/url?url=${encodeURIComponent(href)}`;
}

function filterAndRewriteHTML(htmlContent, baseUrl, proxyBase) {
  const $ = cheerio.load(htmlContent);
  let removedCount = 0;
  let rewrittenCount = 0;

  // Remove ad elements
  HTML_AD_SELECTORS.forEach(selector => {
    try {
      const elements = $(selector);
      removedCount += elements.length;
      elements.remove();
    } catch (e) {}
  });

  // Scripts
  $('script').each((i, el) => {
    const text = $(el).html() || '';
    const src = $(el).attr('src') || '';
    if (src && isAdUrl(src)) {
      $(el).remove(); removedCount++;
    } else if (text && (
      text.includes('adsbygoogle') ||
      text.includes('googlesyndication') ||
      text.includes('doubleclick') ||
      text.includes('gtag(') ||
      text.includes('ga(') ||
      text.includes('fbq(') ||
      text.includes('facebook-jssdk')
    )) {
      $(el).remove(); removedCount++;
    } else if (src) {
      $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  // Stylesheets
  $('link[rel="stylesheet"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href) { $(el).attr('href', proxyUrl(resolveUrl(href, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Favicon / icon
  $('link[rel="icon"], link[rel="shortcut icon"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href) { $(el).attr('href', proxyUrl(resolveUrl(href, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Images
  $('img').each((i, el) => {
    const src = $(el).attr('src');
    const srcset = $(el).attr('srcset');
    if (src) { $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase)); rewrittenCount++; }
    if (srcset) {
      const newSrcset = srcset.split(',').map(part => {
        const [u, descriptor] = part.trim().split(/\s+/);
        return `${proxyUrl(resolveUrl(u, baseUrl), proxyBase)}${descriptor ? ' ' + descriptor : ''}`;
      }).join(', ');
      $(el).attr('srcset', newSrcset);
    }
  });

  // Video / Audio / Source / Track — ALL routed through proxy
  $('video, audio, source, track').each((i, el) => {
    const src = $(el).attr('src');
    if (src) { $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Poster images on video
  $('video[poster]').each((i, el) => {
    const poster = $(el).attr('poster');
    if (poster) { $(el).attr('poster', proxyUrl(resolveUrl(poster, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Iframes (non-ad)
  $('iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && !isAdUrl(src)) {
      $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  // Embed
  $('embed').each((i, el) => {
    const src = $(el).attr('src');
    if (src) { $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Object data
  $('object').each((i, el) => {
    const data = $(el).attr('data');
    if (data) { $(el).attr('data', proxyUrl(resolveUrl(data, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Applet (legacy)
  $('applet').each((i, el) => {
    const code = $(el).attr('code');
    const archive = $(el).attr('archive');
    if (code) { $(el).attr('code', proxyUrl(resolveUrl(code, baseUrl), proxyBase)); rewrittenCount++; }
    if (archive) { $(el).attr('archive', proxyUrl(resolveUrl(archive, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Links
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
      $(el).attr('href', proxyUrl(resolveUrl(href, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  // Forms
  $('form').each((i, el) => {
    const action = $(el).attr('action');
    if (action) { $(el).attr('action', proxyUrl(resolveUrl(action, baseUrl), proxyBase)); rewrittenCount++; }
  });

  // Inline styles url()
  $('[style]').each((i, el) => {
    let style = $(el).attr('style') || '';
    const urlMatches = style.match(/url\((['"]?)([^'"\)]+)\1\)/g);
    if (urlMatches) {
      urlMatches.forEach(match => {
        const inner = match.match(/url\((['"]?)([^'"\)]+)\1\)/);
        if (inner) {
          style = style.replace(match, `url(${proxyUrl(resolveUrl(inner[2], baseUrl), proxyBase)})`);
        }
      });
      $(el).attr('style', style); rewrittenCount++;
    }
  });

  // Base tag
  const head = $('head');
  if (head.length && !$('base').length) {
    head.prepend(`<base href="${baseUrl}">`);
  }

  console.log(`[AD FILTER] Removed ${removedCount} ad elements, rewritten ${rewrittenCount} URLs`);
  return $.html();
}

// ── MAIN PROXY ──
app.get('/url', async (req, res) => {
  const targetUrl = req.query.url || req.query.u;
  const raw = req.query.raw === '1' || req.query.raw === 'true';
  const noRewrite = req.query.norewrite === '1' || req.query.norewrite === 'true';

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing URL parameter',
      usage: '/url?url=http://example.com/path'
    });
  }

  let decodedUrl;
  try { decodedUrl = decodeURIComponent(targetUrl); }
  catch (e) { decodedUrl = targetUrl; }

  if (!decodedUrl.match(/^https?:\/\//i)) {
    return res.status(400).json({ error: 'Invalid URL. Must start with http:// or https://' });
  }

  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proxyBase = `${proto}://${host}`;

  console.log(`[PROXY] Target: ${decodedUrl} | raw=${raw}`);

  try {
    const requestHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] || 'document',
      'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] || 'navigate',
      'Sec-Fetch-Site': req.headers['sec-fetch-site'] || 'none',
      'Upgrade-Insecure-Requests': '1'
    };

    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range;
    }
    if (req.headers.referer) {
      requestHeaders['Referer'] = req.headers.referer;
    }

    const response = await axios({
      method: 'GET',
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

    const upstreamStatus = response.status;
    const contentType = (response.headers['content-type'] || 'application/octet-stream').toLowerCase();
    const contentLength = response.headers['content-length'];

    console.log(`[PROXY] Upstream status: ${upstreamStatus} | Content-Type: ${contentType} | Length: ${contentLength || 'unknown'}`);

    // ── CORS ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    // ── IFRAME BYPASS ──
    for (const h of IFRAME_BLOCKING_HEADERS) {
      if (response.headers[h]) {
        console.log(`[IFRAME BYPASS] Stripped ${h}: ${response.headers[h]}`);
      }
    }

    // Forward headers (NEVER Content-Encoding — axios already decompressed)
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (response.headers['last-modified']) res.setHeader('Last-Modified', response.headers['last-modified']);
    if (response.headers.etag) res.setHeader('ETag', response.headers.etag);
    if (response.headers['cache-control']) res.setHeader('Cache-Control', response.headers['cache-control']);
    if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);

    res.setHeader('X-Proxy-By', 'Express-CORS-Proxy');
    res.setHeader('X-Iframe-Ready', 'yes');
    res.setHeader('X-Original-URL', decodedUrl);
    res.setHeader('X-Upstream-Status', upstreamStatus);

    if (upstreamStatus >= 400) {
      console.log(`[PROXY] Upstream error ${upstreamStatus}, passing through`);
      res.status(upstreamStatus);
      return res.send(response.data);
    }

    const isHTML = contentType.includes('text/html');
    const isCSS = contentType.includes('text/css');

    // ── RAW MODE: pass everything through untouched ──
    if (raw) {
      res.setHeader('X-Ads-Filtered', 'no');
      return res.status(200).send(response.data);
    }

    // ── BINARY / NON-TEXT: proxy through ──
    // Everything that is NOT HTML or CSS gets proxied as-is
    if (!isHTML && !isCSS) {
      console.log(`[PROXY] Binary passthrough: ${contentType}`);
      res.setHeader('X-Ads-Filtered', 'no');
      return res.status(200).send(response.data);
    }

    // ── TEXT PROCESSING ──
    const encoding = contentType.includes('charset=') ? contentType.split('charset=')[1].split(';')[0].trim() : 'utf-8';
    let content;
    try { content = Buffer.from(response.data).toString(encoding); }
    catch (e) { content = Buffer.from(response.data).toString('utf-8'); }

    let processedContent = content;
    let adsRemoved = false;

    if (isHTML) {
      console.log(`[AD FILTER] Processing HTML`);
      if (noRewrite) {
        const $ = cheerio.load(content);
        HTML_AD_SELECTORS.forEach(s => { try { $(s).remove(); } catch (e) {} });
        processedContent = $.html();
      } else {
        processedContent = filterAndRewriteHTML(content, decodedUrl, proxyBase);
      }
      adsRemoved = true;
    } else if (isCSS && !noRewrite) {
      processedContent = content.replace(/url\((['"]?)([^'"\)]+)\1\)/g, (match, quote, href) => {
        return `url(${quote}${proxyUrl(resolveUrl(href, decodedUrl), proxyBase)}${quote})`;
      });
    }

    res.setHeader('X-Ads-Filtered', adsRemoved ? 'yes' : 'no');
    res.status(200).send(processedContent);

  } catch (error) {
    console.error(`[ERROR] Proxy failed:`, error.message);
    if (error.code === 'ECONNREFUSED') return res.status(502).json({ error: 'Connection refused', url: decodedUrl });
    if (error.code === 'ENOTFOUND') return res.status(502).json({ error: 'DNS lookup failed', url: decodedUrl });
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') return res.status(504).json({ error: 'Gateway timeout', url: decodedUrl });
    if (error.response) return res.status(error.response.status).json({ error: 'Upstream error', status: error.response.status, url: decodedUrl });
    res.status(500).json({ error: 'Proxy error', message: error.message, url: decodedUrl });
  }
});

// ── ROUTES ──
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.5.0',
    features: ['cors-bypass', 'iframe-bypass', 'ad-filter-html', 'url-rewrite-all', 'url-rewrite-css', 'binary-proxy', 'range-forwarding']
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'CORS Proxy + Ad Filter + Iframe Bypass',
    description: 'Proxy any URL with CORS headers, iframe embedding support, and conservative ad filtering. ALL traffic routed through proxy.',
    usage: {
      proxy: '/url?url=https://example.com/path',
      raw: '/url?url=https://example.com/path&raw=1',
      noRewrite: '/url?url=https://example.com/path&norewrite=1',
      health: '/health'
    }
  });
});

app.options('*', cors());

module.exports = app;
