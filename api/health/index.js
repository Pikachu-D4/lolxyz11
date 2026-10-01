const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const ytdlpPath = path.join(__dirname, '..', '..', 'bin', 'yt-dlp');

function version(binary, args = ['--version']) {
  return new Promise(resolve => {
    execFile(binary, args, { timeout: 10000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        version: String(stdout || '').trim() || null,
        error: error ? String(stderr || error.message || 'Unknown error') : null,
      });
    });
  });
}

module.exports = async (_req, res) => {
  if (_req.method && _req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  const yt = fs.existsSync(ytdlpPath) ? await version(ytdlpPath) : { ok: false, version: null, error: 'yt-dlp is missing' };
  const ff = ffmpegPath && fs.existsSync(ffmpegPath) ? await version(ffmpegPath) : { ok: false, version: null, error: 'ffmpeg is missing' };
  const healthy = yt.ok && ff.ok;
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    runtime: process.version,
    ytDlp: yt,
    ffmpeg: ff,
    platform: 'YouTube + Instagram public media',
  });
};
