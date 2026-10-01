const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');
const { analyzeFreeYouTube } = require('../../lib/free-youtube');
const { analyze } = require('../../lib/media');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..');

function safeString(value, max) {
  const limit = max || 1200;
  const text = String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b(ed_live|ed_test)_[A-Za-z0-9_-]+\b/g, '[REDACTED_KEY]');
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function classifyError(error) {
  const combined = String(error && (error.stderr || error.message) || '');
  if (error && error.code === 'FREE_YOUTUBE_FAILED') return 'FREE_FRONTENDS_FAILED';
  if (/sign in to confirm.*not a bot/i.test(combined)) return 'YOUTUBE_BOT_BLOCK';
  if (/po.?token|proof.?of.?origin/i.test(combined)) return 'YOUTUBE_PO_TOKEN';
  if (/private video|members-only|login required/i.test(combined)) return 'ACCESS_REQUIRED';
  if (/timed out|timeout/i.test(combined)) return 'TIMEOUT';
  if (/command not found|ENOENT|no such file/i.test(combined)) return 'BINARY_MISSING';
  return 'SERVER_OR_EXTRACTOR_ERROR';
}

async function binaryVersion(binary, args) {
  try {
    const result = await execFileAsync(binary, args || ['--version'], { timeout: 12000, maxBuffer: 1024 * 1024 });
    return { ok: true, version: String(result.stdout || '').trim() };
  } catch (error) {
    return { ok: false, error: safeString(error && (error.stderr || error.message)) };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const requestUrl = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
  const sourceUrl = requestUrl.searchParams.get('url') || '';
  const runFull = requestUrl.searchParams.get('full') === '1';

  const result = {
    success: true,
    timestamp: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    },
    files: {
      ytdlp: {
        path: path.join(ROOT, 'bin', 'yt-dlp'),
        exists: fs.existsSync(path.join(ROOT, 'bin', 'yt-dlp'))
      }
    },
    env: {
      easyDownConfigured: Boolean(String(process.env.EASYDOWN_API_KEY || '').trim()),
      ytdlpOverrideConfigured: Boolean(String(process.env.YTDLP_PATH || '').trim())
    }
  };

  const ytdlpPath = process.env.YTDLP_PATH || path.join(ROOT, 'bin', 'yt-dlp');
  result.files.ytdlp.version = await binaryVersion(ytdlpPath);

  try {
    const ffmpeg = require('ffmpeg-static');
    result.files.ffmpeg = {
      path: ffmpeg,
      exists: Boolean(ffmpeg && fs.existsSync(ffmpeg)),
      version: ffmpeg
        ? await binaryVersion(ffmpeg, ['-version'])
        : { ok: false, error: 'Module returned no path' }
    };
  } catch (error) {
    result.files.ffmpeg = {
      exists: false,
      error: safeString(error && error.message)
    };
  }

  if (!sourceUrl) {
    result.message = 'Pass a public URL in ?url=... . Add &full=1 for the longer direct-extractor test.';
    return res.status(200).json(result);
  }

  try {
    const u = new URL(sourceUrl);
    result.input = {
      host: u.hostname,
      path: u.pathname,
      youtubeId: null
    };
  } catch (error) {
    result.input = { error: 'Invalid URL.' };
    return res.status(400).json(result);
  }

  try {
    result.freeYouTube = await analyzeFreeYouTube(sourceUrl);
    result.freeYouTube.status = 'ok';
  } catch (error) {
    result.freeYouTube = {
      status: 'failed',
      classification: classifyError(error),
      code: safeString(error && error.code),
      message: safeString(error && (error.message || error)),
      attempts: Array.isArray(error && error.attempts)
        ? error.attempts.map(function (item) { return safeString(item, 500); })
        : []
    };
  }

  if (runFull) {
    const started = Date.now();
    try {
      const full = await analyze(sourceUrl);
      result.fullAnalyze = {
        status: 'ok',
        elapsedMs: Date.now() - started,
        platform: full.platform,
        type: full.type,
        title: safeString(full.title, 250),
        formatCount: Array.isArray(full.formats) ? full.formats.length : 0,
        provider: full.provider || 'yt-dlp'
      };
    } catch (error) {
      result.fullAnalyze = {
        status: 'failed',
        elapsedMs: Date.now() - started,
        classification: classifyError(error),
        code: safeString(error && error.code),
        message: safeString(error && (error.message || error)),
        stderr: safeString(error && error.stderr, 1800),
        stdout: safeString(error && error.stdout, 500)
      };
    }
  }

  return res.status(200).json(result);
};
