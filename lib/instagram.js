const { URL } = require('url');

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'instagr.am',
  'www.instagr.am',
]);

function getPostShortcode(input) {
  try {
    const url = new URL(input);
    if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;

    const match = url.pathname.match(/\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)\/?/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function isInstagramUrl(input) {
  return Boolean(getPostShortcode(input));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']\${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']\${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function extractInstagramOpenGraph(html) {
  return {
    title: extractMeta(html, 'og:title'),
    description: extractMeta(html, 'og:description'),
    image: extractMeta(html, 'og:image'),
    video: extractMeta(html, 'og:video') || extractMeta(html, 'og:video:url') || extractMeta(html, 'og:video:secure_url'),
    type: extractMeta(html, 'og:type'),
  };
}

async function fetchInstagramOpenGraph(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    const error = new Error(`Instagram page returned HTTP ${response.status}.`);
    error.code = response.status === 429 ? 'RATE_LIMITED' : 'IG_PAGE_FAILED';
    throw error;
  }

  const html = await response.text();
  return { url: response.url, ...extractInstagramOpenGraph(html) };
}

module.exports = {
  getPostShortcode,
  isInstagramUrl,
  extractInstagramOpenGraph,
  fetchInstagramOpenGraph,
};
