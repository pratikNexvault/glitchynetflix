// pages/api/generate.js (or app/api/generate/route.js for App Router)

// Configuration
const EXTERNAL_API_URL = 'https://nftoken.site/v1/api.php';
const API_KEYS = [
  'NFK_e6f89ac62b838176e150d41f',
  // Add more keys here for rotation if you have them
];
const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000;
const CONCURRENT_LIMIT = 5; // Max simultaneous requests

// Simple in-memory request counter (per instance - okay for serverless)
let activeRequests = 0;

// Helper: sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: robust cookie extraction (superpowered)
function extractCookieValue(rawCookie) {
  if (!rawCookie || typeof rawCookie !== 'string') return null;

  let trimmed = rawCookie.trim();
  if (!trimmed) return null;

  // Try to find NetflixId using multiple patterns
  const patterns = [
    /NetflixId=([^;]+)/i,                     // standard cookie string
    /"NetflixId":"([^"]+)"/i,                 // JSON
    /NetflixId\t([^\t\n]+)/,                  // Netscape format
    /NetflixId\s*=\s*([^\s;]+)/,              // loose assignment
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      let value = match[1].trim();
      // Decode URL-encoded values
      try { value = decodeURIComponent(value); } catch(e) {}
      return value;
    }
  }

  // If no pattern matches, try to parse as JSON array
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const netflixIdObj = parsed.find(c => c.name === 'NetflixId');
      if (netflixIdObj && netflixIdObj.value) return netflixIdObj.value;
    } else if (parsed.NetflixId) {
      return parsed.NetflixId;
    }
  } catch(e) {}

  return null;
}

// Main handler
export default async function handler(req, res) {
  // Enable CORS if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Rate limiting by concurrent requests (basic)
  if (activeRequests >= CONCURRENT_LIMIT) {
    return res.status(429).json({ error: 'Too many concurrent requests. Try again.' });
  }

  const { cookie: raw_cookie } = req.body || {};
  if (!raw_cookie || typeof raw_cookie !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid cookie.' });
  }

  // Extract NetflixId for quick validation
  const netflixId = extractCookieValue(raw_cookie);
  if (!netflixId) {
    return res.status(400).json({ error: 'Could not find NetflixId in cookie data.' });
  }

  activeRequests++;

  try {
    const result = await callExternalAPIWithRetry(raw_cookie);
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] API error:`, error.message);
    // Classify error for client
    if (error.type === 'EXPIRED') {
      return res.status(200).json({ expired: true, error: error.message });
    }
    if (error.type === 'NETWORK') {
      return res.status(502).json({ error: 'Token service unreachable.' });
    }
    if (error.type === 'TIMEOUT') {
      return res.status(504).json({ error: 'Request timed out.' });
    }
    return res.status(500).json({ error: error.message || 'Internal server error.' });
  } finally {
    activeRequests--;
  }
}

// Call external API with retries and rotation
async function callExternalAPIWithRetry(cookie, attempt = 1) {
  const key = API_KEYS[(attempt - 1) % API_KEYS.length]; // rotate on each retry

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(EXTERNAL_API_URL, {

      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, cookie }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    // Check if the external API indicates expired/invalid cookie
    if (data.expired === true || (data.error && data.error.toLowerCase().includes('expired'))) {
      const err = new Error(data.error || 'Cookie expired or invalid.');
      err.type = 'EXPIRED';
      throw err;
    }

    // Validate that we got a token/URL
    if (!data.url && !data.token) {
      throw new Error('External API returned success but no token or URL.');
    }

    // Add a timestamp for client convenience
    data.generated_at = Math.floor(Date.now() / 1000);

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      const err = new Error('Request timeout');
      err.type = 'TIMEOUT';
      throw err;
    }

    // Retry on network errors or 5xx responses
    if (attempt < MAX_RETRIES && (error.cause?.code === 'ECONNRESET' || error.message.includes('fetch'))) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
      await sleep(delay);
      return callExternalAPIWithRetry(cookie, attempt + 1);
    }

    // Otherwise, rethrow with type NETWORK
    const err = new Error(error.message);
    err.type = 'NETWORK';
    throw err;
  }
}
Show quoted text
