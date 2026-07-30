const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const url = require('url');

const app = express();

// ── CORS ──
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

// ── AD CONFIG ──
const AD_DOMAINS = [
  'googleadservices.com','googlesyndication.com','doubleclick.net',
  'google-analytics.com','facebook.com','fbcdn.net',
  'amazon-adsystem.com','adsystem.amazon.com','advertising.com',
  'adsrvr.org','adsymptotic.com','adnxs.com','rubiconproject.com',
  'openx.net','pubmatic.com','casalemedia.com','contextweb.com',
  'bluekai.com','exelator.com','mathtag.com','crwdcntrl.net',
  'tapad.com','tradedoubler.com','criteo.com','outbrain.com',
  'taboola.com','revcontent.com','mgid.com','adroll.com',
  'adform.net','smartadserver.com','adtech.de','adtechus.com',
  'aolcdn.com','yahoo.com','bing.com','scorecardresearch.com',
  'quantserve.com','moatads.com','chartbeat.com','parsely.com',
  'segment.io','mixpanel.com','amplitude.com','hotjar.com',
  'luckyorange.com','inspectlet.com','fullstory.com','logrocket.com',
  'sentry.io','bugsnag.com','newrelic.com','datadoghq.com'
];

const HTML_AD_SELECTORS = [
  'iframe[src*="ad"], iframe[src*="ads"], iframe[src*="doubleclick"], iframe[src*="googleads"], iframe[src*="facebook"], iframe[src*="tracking"]',
  'script[src*="ad"], script[src*="ads"], script[src*="doubleclick"], script[src*="googleads"], script[src*="googlesyndication"], script[src*="google-analytics"], script[src*="facebook"], script[src*="tracking"], script[src*="analytics"]',
  'div[class*="ad-"], div[class*="ads-"], div[class*="advertisement"], div[class*="banner"], div[class*="sponsored"]',
  'div[id*="ad-"], div[id*="ads-"], div[id*="advertisement"], div[id*="banner"]',
  'ins.adsbygoogle',
  '.ad-container, .ad-wrapper, .ad-banner, .ad-slot, .ad-unit',
  '[data-ad-slot], [data-ad-client], [data-ad-format]',
  'img[src*="ad"], img[src*="banner"], img[src*="tracking"], img[src*="pixel"]',
  'a[href*="ad"], a[href*="sponsored"], a[href*="tracking"]',
  'video[src*="ad"], audio[src*="ad"]'
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

  HTML_AD_SELECTORS.forEach(selector => {
    try {
      const elements = $(selector);
      removedCount += elements.length;
      elements.remove();
    } catch (e) {}
  });

  $('script').each((i, el) => {
    const text = $(el).html() || '';
    const src = $(el).attr('src') || '';
    if (src && isAdUrl(src)) {
      $(el).remove(); removedCount++;
    } else if (text && (text.includes('googleads') || text.includes('adsbygoogle') ||
                         text.includes('gtag') || text.includes('analytics') ||
                         text.includes('fbq') || text.includes('facebook-pixel') ||
                         text.includes('tracking') || text.includes('beacon'))) {
      $(el).remove(); removedCount++;
    } else if (src) {
      $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  $('noscript').each((i, el) => {
    const html = $(el).html() || '';
    if (html.includes('pixel') || html.includes('tracking') || html.includes('img')) {
      $(el).remove(); removedCount++;
    }
  });

  $('link[rel="stylesheet"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href) { $(el).attr('href', proxyUrl(resolveUrl(href, baseUrl), proxyBase)); rewrittenCount++; }
  });

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

  $('video, audio, source').each((i, el) => {
    const src = $(el).attr('src');
    if (src) { $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase)); rewrittenCount++; }
  });

  $('iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && !isAdUrl(src)) {
      $(el).attr('src', proxyUrl(resolveUrl(src, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
      $(el).attr('href', proxyUrl(resolveUrl(href, baseUrl), proxyBase));
      rewrittenCount++;
    }
  });

  $('form').each((i, el) => {
    const action = $(el).attr('action');
    if (action) { $(el).attr('action', proxyUrl(resolveUrl(action, baseUrl), proxyBase)); rewrittenCount++; }
  });

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

  // Dynamic proxy base from request (works on Vercel + local)
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proxyBase = `${proto}://${host}`;

  console.log(`[PROXY] Target: ${decodedUrl} | Base: ${proxyBase}`);

  try {
    const requestHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': req.headers['accept-encoding'] || 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] || 'document',
      'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] || 'navigate',
      'Sec-Fetch-Site': req.headers['sec-fetch-site'] || 'none',
      'Upgrade-Insecure-Requests': '1'
    };
    if (req.headers.referer) requestHeaders['Referer'] = req.headers.referer;

    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: requestHeaders,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      return res.status(response.status).send(response.data);
    }

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const contentLength = response.headers['content-length'];

    // ── CORS ──
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    // ── IFRAME BYPASS ──
    for (const h of IFRAME_BLOCKING_HEADERS) {
      if (response.headers[h]) console.log(`[IFRAME BYPASS] Stripped ${h}`);
    }

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (response.headers['last-modified']) res.setHeader('Last-Modified', response.headers['last-modified']);
    if (response.headers.etag) res.setHeader('ETag', response.headers.etag);
    if (response.headers['cache-control']) res.setHeader('Cache-Control', response.headers['cache-control']);
    if (response.headers['content-encoding']) res.setHeader('Content-Encoding', response.headers['content-encoding']);

    const isBinary = contentType.match(/(image|video|audio|application\/octet-stream|font|wasm)/i);
    const isHTML = contentType.includes('text/html');
    const isCSS = contentType.includes('text/css');
    const isText = contentType.includes('text/') || contentType.includes('json');

    if (isBinary && !isHTML) {
      res.setHeader('X-Proxy-By', 'Express-CORS-Proxy');
      res.setHeader('X-Iframe-Ready', 'yes');
      return res.send(response.data);
    }

    if (raw) {
      res.setHeader('X-Proxy-By', 'Express-CORS-Proxy');
      res.setHeader('X-Iframe-Ready', 'yes');
      return res.send(response.data);
    }

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
    } else if (isText) {
      AD_DOMAINS.forEach(domain => {
        const regex = new RegExp(`https?://[^\s"\']*${domain.replace(/\./g, '\\.')}[^\s"\']*`, 'gi');
        processedContent = processedContent.replace(regex, '');
      });
    }

    res.setHeader('X-Proxy-By', 'Express-CORS-Proxy');
    res.setHeader('X-Iframe-Ready', 'yes');
    res.setHeader('X-Ads-Filtered', adsRemoved ? 'yes' : 'no');
    res.setHeader('X-Original-URL', decodedUrl);
    res.send(processedContent);

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
    version: '2.1.0',
    features: ['cors-bypass', 'iframe-bypass', 'ad-filter-html', 'url-rewrite-html', 'url-rewrite-css', 'binary-proxy']
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'CORS Proxy + Ad Filter + Iframe Bypass',
    description: 'Proxy any URL with CORS headers, iframe embedding support, and ad filtering',
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
