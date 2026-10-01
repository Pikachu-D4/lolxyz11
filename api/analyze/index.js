const { validateUrl } = require('../../lib/validation');
const { analyze } = require('../../lib/media');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ success: false, error: 'Invalid JSON body.' }); }

  const url = String(body.url || '').trim();
  const check = validateUrl(url);
  if (!check.valid) return res.status(400).json({ success: false, error: check.error });

  try {
    const result = await analyze(url);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Eomeg analyze]', error);
    return res.status(502).json({
      success: false,
      error: friendlyError(error, url)
    });
  }
};

function friendlyError(error, url) {
  const msg = String(error?.stderr || error?.message || '');

  // "Sign in to confirm you're not a bot" is a YouTube anti-automation
  // response and must not be presented as proof that the media is private.
  if (/sign in to confirm.*not a bot|LOGIN_REQUIRED/i.test(msg) && /youtube\.com|youtu\.be/i.test(url)) {
    return 'YouTube is currently blocking automated requests from this server. The video is not necessarily private; please try again later.';
  }

  // Only classify explicit private/auth-required media as private.
  if (/this video is private|private video|members-only|login required for this video|age.?restricted/i.test(msg)) {
    return 'This media requires access that this server does not have.';
  }

  if (/unsupported|not a valid url/i.test(msg)) return 'This URL is not currently supported.';
  if (/timeout|timed out/i.test(msg)) return 'The media service took too long to respond.';
  return 'We could not analyze this media. Please try another public URL.';
}
