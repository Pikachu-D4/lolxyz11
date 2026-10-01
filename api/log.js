const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const YTDLP = process.env.YTDLP_PATH || path.join(ROOT, 'bin', 'yt-dlp');

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me'
];

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.tiekoetter.com'
];

function redact(value) {
  return String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b(ed_live|ed_test)_[A-Za-z0-9_-]+\b/g, '[REDACTED_KEY]')
    .replace(/\s+/g, ' ')
    .trim();
}

function classify(text) {
  const s = String(text || '');
  if (/sign in to confirm.*not a bot/i.test(s)) return 'YOUTUBE_BOT_BLOCK';
  if (/po.?token|proof.?of.?origin/i.test(s)) return 'YOUTUBE_PO_TOKEN';
  if (/private video|members-only|login required/i.test(s)) return 'ACCESS_REQUIRED';
  if (/timed out|timeout/i.test(s)) return 'TIMEOUT';
  if (/ENOENT|not found|no such file/i.test(s)) return 'BINARY_MISSING';
  if (/403|forbidden/i.test(s)) return 'HTTP_403';
  if (/429|too many requests/i.test(s)) return 'HTTP_429';
  return 'OTHER';
}

async function requestJson(url, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs || 5000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Eomeg-Diagnostics/1.0'
      }
    });
    const elapsedMs = Date.now() - started;
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      data,
      bodyPreview: redact(text).slice(0, 500)
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      elapsedMs: Date.now() - started,
      error: redact(error && (error.message || error))
    };
  }
}

async function binaryVersion(binary, args) {
  try {
    const r = await execFileAsync(binary, args || ['--version'], {
      timeout: 4000,
      maxBuffer: 1024 * 1024
    });
    return { ok: true, version: String(r.stdout || '').trim() };
  } catch (error) {
    return { ok: false, error: redact(error && (error.stderr || error.message)) };
  }
}

async function runYtDlp(url, embedded) {
  const args = [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--ignore-config',
    '--socket-timeout', '8',
    '--retries', '0',
    '--js-runtimes', 'node:' + process.execPath,
    '--remote-components', 'ejs:github'
  ];

  if (embedded) {
    args.push('--extractor-args', 'youtube:player_client=web_embedded');
  }

  args.push('--', url);

  const started = Date.now();
  try {
    const r = await execFileAsync(YTDLP, args, {
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024
    });
    let info = null;
    try { info = JSON.parse(String(r.stdout || '').trim()); } catch {}

    return {
      status: 'ok',
      elapsedMs: Date.now() - started,
      extractor: info && (info.extractor_key || info.extractor) || null,
      title: info && info.title ? redact(info.title).slice(0, 180) : null,
      formatCount: info && Array.isArray(info.formats) ? info.formats.length : 0,
      height: info && info.height || null,
      vcodec: info && info.vcodec || null,
      acodec: info && info.acodec || null
    };
  } catch (error) {
    const combined = String(error && error.message || '') + '\n' + String(error && error.stderr || '');
    return {
      status: 'failed',
      elapsedMs: Date.now() - started,
      classification: classify(combined),
      message: redact(error && (error.message || error)),
      stderr: redact(error && error.stderr).slice(0, 2200)
    };
  }
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendText(res, 405, 'Method not allowed\n');
  }

  try {
    const requestUrl = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
    const sourceUrl = requestUrl.searchParams.get('url') || '';
    const startedAll = Date.now();
    const lines = [];

    lines.push('EOMEG DOWNLOADER DIAGNOSTIC LOG');
    lines.push('================================');
    lines.push('Generated: ' + new Date().toISOString());
    lines.push('Node: ' + process.version);
    lines.push('Platform: ' + process.platform + '/' + process.arch);
    lines.push('Vercel region: ' + (process.env.VERCEL_REGION || 'unknown'));
    lines.push('Deployment: ' + (process.env.VERCEL_DEPLOYMENT_ID || 'unknown'));
    lines.push('EASYDOWN configured: ' + Boolean(String(process.env.EASYDOWN_API_KEY || '').trim()));
    lines.push('');

    lines.push('[BINARIES]');
    lines.push('yt-dlp path: ' + YTDLP);
    lines.push('yt-dlp exists: ' + fs.existsSync(YTDLP));
    if (fs.existsSync(YTDLP)) {
      const yv = await binaryVersion(YTDLP);
      lines.push('yt-dlp version: ' + (yv.version || yv.error || 'unknown'));
    }

    try {
      const ffmpeg = require('ffmpeg-static');
      const exists = Boolean(ffmpeg && fs.existsSync(ffmpeg));
      lines.push('ffmpeg path: ' + (ffmpeg || 'missing'));
      lines.push('ffmpeg exists: ' + exists);
      if (exists) {
        const fv = await binaryVersion(ffmpeg, ['-version']);
        lines.push('ffmpeg version: ' + (fv.version || fv.error || 'unknown'));
      }
    } catch (error) {
      lines.push('ffmpeg error: ' + redact(error && error.message));
    }
    lines.push('');

    if (!sourceUrl) {
      lines.push('[USAGE]');
      lines.push('Open /log?url=<public-YouTube-URL>');
      return sendText(res, 200, lines.join('\n') + '\n');
    }

    let videoId = null;
    try {
      const u = new URL(sourceUrl);
      if (u.hostname.toLowerCase() === 'youtu.be' || u.hostname.toLowerCase() === 'www.youtu.be') {
        videoId = u.pathname.slice(1).split('/')[0] || null;
      } else if (u.hostname.toLowerCase().endsWith('youtube.com')) {
        videoId = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/i) || [])[1] || null;
      }
    } catch {}

    lines.push('[INPUT]');
    lines.push('Valid YouTube URL: ' + Boolean(videoId));
    lines.push('Video ID: ' + (videoId || 'INVALID'));
    lines.push('');

    if (!videoId) {
      return sendText(res, 400, lines.join('\n') + 'RESULT: Invalid YouTube URL.\n');
    }

    lines.push('[YOUTUBE OEMBED]');
    const oembed = await requestJson(
      'https://www.youtube.com/oembed?url=' + encodeURIComponent(sourceUrl) + '&format=json',
      5000
    );
    lines.push('HTTP: ' + (oembed.status == null ? 'NETWORK_ERROR' : oembed.status));
    lines.push('Elapsed ms: ' + oembed.elapsedMs);
    lines.push('Metadata reachable: ' + Boolean(oembed.ok && oembed.data));
    if (oembed.data) {
      lines.push('Title: ' + redact(oembed.data.title).slice(0, 180));
      lines.push('Author: ' + redact(oembed.data.author_name));
    } else {
      lines.push('Response: ' + (oembed.bodyPreview || oembed.error || ''));
    }
    lines.push('');

    lines.push('[PIPED INSTANCES]');
    const piped = await Promise.all(PIPED.map(async function (base) {
      const r = await requestJson(base + '/streams/' + videoId, 5000);
      return {
        base,
        status: r.status,
        elapsedMs: r.elapsedMs,
        ok: Boolean(r.ok && r.data && (r.data.videoStreams || r.data.title)),
        streams: r.data && Array.isArray(r.data.videoStreams) ? r.data.videoStreams.length : null,
        error: r.error || (r.status && !r.ok ? r.bodyPreview : '')
      };
    }));
    piped.forEach(function (r) {
      lines.push(r.base + ': HTTP ' + (r.status == null ? 'ERR' : r.status) + ', ' + r.elapsedMs + 'ms, ' + (r.ok ? 'OK' : 'FAIL') + (r.streams != null ? ', streams=' + r.streams : '') + (r.error ? ', ' + redact(r.error) : ''));
    });
    lines.push('');

    lines.push('[INVIDIOUS INSTANCES]');
    const inv = await Promise.all(INVIDIOUS.map(async function (base) {
      const r = await requestJson(base + '/api/v1/videos/' + videoId + '?local=true', 5000);
      return {
        base,
        status: r.status,
        elapsedMs: r.elapsedMs,
        ok: Boolean(r.ok && r.data && (r.data.formatStreams || r.data.title)),
        streams: r.data && Array.isArray(r.data.formatStreams) ? r.data.formatStreams.length : null,
        error: r.error || (r.status && !r.ok ? r.bodyPreview : '')
      };
    }));
    inv.forEach(function (r) {
      lines.push(r.base + ': HTTP ' + (r.status == null ? 'ERR' : r.status) + ', ' + r.elapsedMs + 'ms, ' + (r.ok ? 'OK' : 'FAIL') + (r.streams != null ? ', formatStreams=' + r.streams : '') + (r.error ? ', ' + redact(r.error) : ''));
    });
    lines.push('');

    lines.push('[DIRECT YT-DLP]');
    const normal = await runYtDlp(sourceUrl, false);
    lines.push('Status: ' + normal.status);
    lines.push('Elapsed ms: ' + normal.elapsedMs);
    if (normal.status === 'ok') {
      lines.push('Extractor: ' + (normal.extractor || ''));
      lines.push('Title: ' + (normal.title || ''));
      lines.push('Formats: ' + normal.formatCount);
      lines.push('Height: ' + (normal.height || ''));
      lines.push('Video codec: ' + (normal.vcodec || ''));
      lines.push('Audio codec: ' + (normal.acodec || ''));
    } else {
      lines.push('Classification: ' + normal.classification);
      lines.push('Message: ' + normal.message);
      lines.push('stderr: ' + normal.stderr);
    }

    lines.push('');
    lines.push('[YT-DLP WEB-EMBEDDED]');
    const embedded = await runYtDlp(sourceUrl, true);
    lines.push('Status: ' + embedded.status);
    lines.push('Elapsed ms: ' + embedded.elapsedMs);
    if (embedded.status === 'ok') {
      lines.push('Extractor: ' + (embedded.extractor || ''));
      lines.push('Title: ' + (embedded.title || ''));
      lines.push('Formats: ' + embedded.formatCount);
      lines.push('Height: ' + (embedded.height || ''));
      lines.push('Video codec: ' + (embedded.vcodec || ''));
      lines.push('Audio codec: ' + (embedded.acodec || ''));
    } else {
      lines.push('Classification: ' + embedded.classification);
      lines.push('Message: ' + embedded.message);
      lines.push('stderr: ' + embedded.stderr);
    }

    lines.push('');
    lines.push('[SUMMARY]');
    const freeOk = piped.some(function (r) { return r.ok; }) || inv.some(function (r) { return r.ok; });
    const directOk = normal.status === 'ok' || embedded.status === 'ok';
    lines.push('Free frontend available: ' + freeOk);
    lines.push('Direct yt-dlp available: ' + directOk);
    lines.push('Overall: ' + (freeOk || directOk ? 'AT LEAST ONE EXTRACTION PATH WORKS' : 'ALL TESTED EXTRACTION PATHS FAILED'));
    lines.push('Total ms: ' + (Date.now() - startedAll));
    lines.push('');
    lines.push('NOTE: keys, cookies, signed media URLs and full upstream payloads are intentionally omitted.');

    return sendText(res, 200, lines.join('\n') + '\n');
  } catch (error) {
    return sendText(res, 500, [
      'EOMEG DIAGNOSTIC ENDPOINT ERROR',
      '================================',
      'Type: ' + (error && error.name || 'Error'),
      'Message: ' + redact(error && (error.message || error)),
      'Stack: ' + redact(error && error.stack).slice(0, 2500)
    ].join('\n') + '\n');
  }
};
