// api/generate.js

const EXTERNAL_API_URL = 'https://nftoken.site/v1/api.php';
const API_KEY = 'NFK_e6f89ac62b838176e150d41f';
const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractNetflixCookie(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  const patterns = [
    /NetflixId=([^;]+)/i,
    /"NetflixId"\s*:\s*"([^"]+)"/i,
    /NetflixId\t([^\t\n]+)/,
    /NetflixId\s*=\s*([^\s;]+)/,
  ];

  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m?.[1]) {
      try { return decodeURIComponent(m[1].trim()); } catch { return m[1].trim(); }
    }
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const obj = parsed.find(c => c.name === 'NetflixId');
      return obj?.value || null;
    }
    return parsed.NetflixId || null;
  } catch { return null; }
}

async function callWithRetry(cookie, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(EXTERNAL_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: API_KEY, cookie }),
      signal:  controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const err = new Error(`External API responded with ${res.status}`);
      err.type = 'NETWORK';
      throw err;
    }

    const data = await res.json();

    if (
      data.expired === true ||
      data.status  === false ||
      (data.error && /expired|invalid/i.test(data.error))
    ) {
      throw Object.assign(new Error(data.error || 'Cookie expired or invalid.'), { type: 'EXPIRED' });
    }

    const tokenUrl = data.url || data.token || data.link;
    if (!tokenUrl) throw new Error('API returned no token URL.');

    let expires_ts;
    if (data.expires_at)      expires_ts = data.expires_at;
    else if (data.expires_in) expires_ts = Math.floor(Date.now() / 1000) + data.expires_in;
    else                      expires_ts = Math.floor(Date.now() / 1000) + 6 * 3600;

    return { url: tokenUrl, expires_ts, generated_at: Math.floor(Date.now() / 1000) };

  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Request timed out.'), { type: 'TIMEOUT' });
    }

    if (err.type === 'EXPIRED') throw err;

    if (attempt < MAX_RETRIES) {
      await sleep(Math.min(1000 * 2 ** attempt, 5000));
      return callWithRetry(cookie, attempt + 1);
    }

    throw Object.assign(err, { type: err.type || 'NETWORK' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed.' });

  const { cookie: rawCookie } = req.body || {};
  if (!rawCookie || typeof rawCookie !== 'string')
    return res.status(400).json({ error: 'Cookie is required.' });

  const netflixId = extractNetflixCookie(rawCookie);
  if (!netflixId)
    return res.status(400).json({ error: 'NetflixId not found in cookie.' });

  try {
    const result = await callWithRetry(rawCookie);
    return res.status(200).json(result);

  } catch (err) {
    const map = {
      EXPIRED: [200, { expired: true,  error: err.message }],
      TIMEOUT: [504, { error: 'Request timed out. Retry karo.' }],
      NETWORK: [502, { error: 'Token service unreachable.' }],
    };
    const [status, body] = map[err.type] || [500, { error: err.message || 'Internal error.' }];
    return res.status(status).json(body);
  }
}
