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
      error: friendlyError(error)
    });
  }
};

function friendlyError(error) {
  const msg = String(error?.stderr || error?.message || '');
  if (/private|login|sign in|authentication/i.test(msg)) return 'This media is private or requires authentication.';
  if (/unsupported|not a valid url/i.test(msg)) return 'This URL is not currently supported.';
  if (/timeout|timed out/i.test(msg)) return 'The media service took too long to respond.';
  return 'We could not analyze this media. Please try another public URL.';
}
