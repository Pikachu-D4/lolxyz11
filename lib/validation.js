const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am']);

function detectPlatform(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host)) return 'youtube';
    if (INSTAGRAM_HOSTS.has(host)) return 'instagram';
  } catch {}
  return null;
}

function validateUrl(input) {
  if (!input || typeof input !== 'string') return { valid: false, error: 'Please enter a valid URL.' };
  let u;
  try { u = new URL(input.trim()); } catch { return { valid: false, error: 'Please enter a valid URL.' }; }
  if (!['https:', 'http:'].includes(u.protocol)) return { valid: false, error: 'Only HTTP and HTTPS URLs are supported.' };
  const platform = detectPlatform(input.trim());
  if (!platform) return { valid: false, error: 'Please enter a supported YouTube or Instagram URL.' };
  if (platform === 'youtube') {
    const ok = /^\/(watch|shorts|embed)\//i.test(u.pathname) || u.hostname.toLowerCase().includes('youtu.be') || u.searchParams.has('v');
    if (!ok) return { valid: false, error: 'Please enter a YouTube video or Short URL.' };
  }
  if (platform === 'instagram') {
    const ok = /^\/(p|reel|reels|tv|share\/reel|share\/p)\//i.test(u.pathname);
    if (!ok) return { valid: false, error: 'Please enter an Instagram post or Reel URL.' };
  }
  return { valid: true, platform };
}

module.exports = { detectPlatform, validateUrl };
