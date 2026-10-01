const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');
const { extractYouTubeId } = require('../../lib/free-youtube');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..');
const YTDLP = process.env.YTDLP_PATH || path.join(ROOT, 'bin', 'yt-dlp');

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
];
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.tiekoetter.com',
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

async function timeFetch(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5500),
      headers: { Accept: 'application/json', 'User-Agent': 'Eomeg-Diagnostics/1.0' }
    });
    return { ok: response.ok, status: response.status, elapsedMs: Date.now() - started, response: response };
  } catch (error) {
    return { ok: false, status: null, elapsedMs: Date.now() - started, error: String(error && error.message || error) };
  }
}

async function binaryVersion(binary, args) {
  try {
    const r = await execFileAsync(binary, args || ['--version'], { timeout: 10000, maxBuffer: 1024 * 1024 });
    return { ok: true, version: String(r.stdout || '').trim() };
  } catch (error) {
    return { ok: false, error: redact(error && (error.stderr || error.message)) };
  }
}

async function runYtDlp(url, embedded) {
  const args = [
    '--dump-single-json', '--skip-download', '--no-warnings', '--ignore-config',
    '--socket-timeout', '15', '--retries', '1',
    '--js-runtimes', 'node:' + process.execPath,
    '--remote-components', 'ejs:github'
  ];
  if (embedded) args.push('--extractor-args', 'youtube:player_client=web_embedded');
  args.push('--', url);
  const started = Date.now();
  try {
    const r = await execFileAsync(YTDLP, args, { timeout: 22000, maxBuffer: 12 * 1024 * 1024 });
    const raw = String(r.stdout || '').trim();
    let info = null;
    try { info = JSON.parse(raw); } catch {}
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
    const text = String(error && error.message || '') + '\n' + String(error && error.stderr || '');
    return {
      status: 'failed',
      elapsedMs: Date.now() - started,
      classification: classify(text),
      message: redact(error && (error.message || error)),
      stderr: redact(error && error.stderr).slice(0, 2200)
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).type('text/plain').send('Method not allowed');

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
    lines.push('Example: /log?url=https%3A%2F%2Fyoutu.be%2FVIDEO_ID');
    return res.status(200).type('text/plain').send(lines.join('\n') + '\n');
  }

  const videoId = extractYouTubeId(sourceUrl);
  lines.push('[INPUT]');
  lines.push('Valid YouTube URL: ' + Boolean(videoId));
  lines.push('Video ID: ' + (videoId || 'INVALID'));
  lines.push('');

  if (!videoId) {
    lines.push('RESULT: Invalid or unsupported YouTube URL.');
    return res.status(400).type('text/plain').send(lines.join('\n') + '\n');
  }

  lines.push('[YOUTUBE OEMBED]');
  const oembed = await timeFetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(sourceUrl) + '&format=json');
  lines.push('HTTP: ' + (oembed.status == null ? 'NETWORK_ERROR' : oembed.status));
  lines.push('Elapsed ms: ' + oembed.elapsedMs);
  if (oembed.ok) {
    const data = await oembed.response.json().catch(function () { return null; });
    lines.push('Metadata reachable: ' + Boolean(data));
    lines.push('Title: ' + (data && data.title ? redact(data.title).slice(0, 180) : ''));
    lines.push('Author: ' + (data && data.author_name ? redact(data.author_name) : ''));
  } else {
    lines.push('Error: ' + redact(oembed.error || 'non-2xx response'));
  }
  lines.push('');

  lines.push('[PIPED INSTANCES]');
  const piped = await Promise.all(PIPED.map(async function (base) {
    const r = await timeFetch(base + '/streams/' + videoId);
    if (!r.ok) return { base: base, status: r.status, elapsedMs: r.elapsedMs, ok: false, error: redact(r.error || '') };
    const data = await r.response.json().catch(function () { return null; });
    return {
      base: base, status: r.status, elapsedMs: r.elapsedMs, ok: Boolean(data && (data.videoStreams || data.title)),
      streams: data && Array.isArray(data.videoStreams) ? data.videoStreams.length : 0,
      title: data && data.title ? redact(data.title).slice(0, 120) : ''
    };
  }));
  piped.forEach(function (r) {
    lines.push(r.base + ': HTTP ' + (r.status == null ? 'ERR' : r.status) + ', ' + r.elapsedMs + 'ms, ' + (r.ok ? 'OK' : 'FAIL') + (r.streams != null ? ', streams=' + r.streams : '') + (r.error ? ', ' + r.error : ''));
  });
  lines.push('');

  lines.push('[INVIDIOUS INSTANCES]');
  const inv = await Promise.all(INVIDIOUS.map(async function (base) {
    const r = await timeFetch(base + '/api/v1/videos/' + videoId + '?local=true');
    if (!r.ok) return { base: base, status: r.status, elapsedMs: r.elapsedMs, ok: false, error: redact(r.error || '') };
    const data = await r.response.json().catch(function () { return null; });
    return {
      base: base, status: r.status, elapsedMs: r.elapsedMs, ok: Boolean(data && (data.formatStreams || data.title)),
      streams: data && Array.isArray(data.formatStreams) ? data.formatStreams.length : 0,
      title: data && data.title ? redact(data.title).slice(0, 120) : ''
    };
  }));
  inv.forEach(function (r) {
    lines.push(r.base + ': HTTP ' + (r.status == null ? 'ERR' : r.status) + ', ' + r.elapsedMs + 'ms, ' + (r.ok ? 'OK' : 'FAIL') + (r.streams != null ? ', formatStreams=' + r.streams : '') + (r.error ? ', ' + r.error : ''));
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

  const freeOk = piped.some(function (r) { return r.ok; }) || inv.some(function (r) { return r.ok; });
  const directOk = normal.status === 'ok' || embedded.status === 'ok';
  lines.push('[SUMMARY]');
  lines.push('Free frontend available: ' + freeOk);
  lines.push('Direct yt-dlp available: ' + directOk);
  lines.push('Overall: ' + (freeOk || directOk ? 'AT LEAST ONE PATH WORKS' : 'ALL TESTED PATHS FAILED'));
  lines.push('Total ms: ' + (Date.now() - startedAll));
  lines.push('');
  lines.push('NOTE: keys, cookies, signed media URLs and full upstream payloads are intentionally omitted.');

  return res.status(200).type('text/plain').send(lines.join('\n') + '\n');
}
