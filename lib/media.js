const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { fetchInstagramOpenGraph, isInstagramUrl } = require('./instagram');

const ROOT = path.resolve(__dirname, '..');
const YTDLP = (process.env.YTDLP_PATH || path.join(ROOT, 'bin', 'yt-dlp')).trim();
const PROCESS_TIMEOUT_MS = 290000;
const MAX_OUTPUT_BYTES = 450 * 1024 * 1024;

function assertBinary() {
  if (YTDLP !== 'yt-dlp' && !fs.existsSync(YTDLP)) {
    throw new Error('yt-dlp executable is missing. Run npm install to install the bundled binary.');
  }
}

function tempDir() {
  const dir = path.join(os.tmpdir(), `eomeg-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function runYtDlp(args, timeoutMs = PROCESS_TIMEOUT_MS) {
  assertBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, {
      cwd: os.tmpdir(),
      env: { ...process.env, HOME: os.tmpdir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        const err = new Error('yt-dlp timed out.');
        err.stderr = stderr;
        err.code = 'TIMEOUT';
        return reject(err);
      }
      if (code !== 0) {
        const err = new Error(`yt-dlp exited with code ${code}.`);
        err.stderr = stderr;
        err.stdout = stdout;
        err.code = 'YTDLP_FAILED';
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function getInfo(url) {
  const baseArgs = [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--ignore-config',
    '--socket-timeout', '25',
    '--retries', '2',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
  ];

  const args = [...baseArgs, '--', url];

  let result;
  try {
    result = await runYtDlp(args);
  } catch (error) {
    const message = String(error?.stderr || error?.message || '');

    // YouTube may reject a server-side guest request with the generic
    // "Sign in to confirm you're not a bot" response. That does not mean
    // that the video is private. Retry once with YouTube's public embedded
    // player client, which currently does not require a GVS PO token.
    if (/sign in to confirm.*not a bot|LOGIN_REQUIRED/i.test(message) && /youtube\.com|youtu\.be/i.test(url)) {
      const fallbackArgs = [
        ...baseArgs,
        '--extractor-args', 'youtube:player_client=web_embedded,android,tv,ios',
        '--', url,
      ];

      try {
        result = await runYtDlp(fallbackArgs);
      } catch (fallbackError) {
        fallbackError.stderr = `${String(fallbackError.stderr || fallbackError.message || '')}\n${message}`;
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }
  const text = result.stdout.trim();
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    const err = new Error('yt-dlp returned invalid metadata.');
    err.stderr = result.stderr;
    throw err;
  }
}

function qualityLabel(height) {
  const h = Number(height) || 0;
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 500) return '540p';
  if (h >= 400) return '480p';
  if (h >= 300) return '360p';
  if (h >= 200) return '240p';
  return h ? `${h}p` : 'Best';
}

function normalizeSize(n) {
  return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
}

function buildFormats(info, platform) {
  const source = Array.isArray(info?.formats) ? info.formats : [];
  const out = [];

  if (platform === 'youtube') {
    const heights = [...new Set(source
      .filter(f => f && f.vcodec && f.vcodec !== 'none' && Number(f.height))
      .map(f => Number(f.height)))]
      .sort((a, b) => b - a);

    for (const height of heights) {
      const bestVideo = source
        .filter(f => Number(f.height) === height && f.vcodec && f.vcodec !== 'none')
        .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
      if (!bestVideo) continue;
      const selector = `bestvideo[height=${height}]+bestaudio/best[height=${height}]`;
      out.push({
        id: selector,
        selector,
        quality: qualityLabel(height),
        height,
        width: bestVideo.width || null,
        fps: bestVideo.fps || null,
        codec: bestVideo.vcodec || null,
        format: 'mp4',
        hasAudio: true,
        fileSize: null,
        directUrl: null,
        merge: true,
      });
    }
  } else {
    const candidates = source
      .filter(f => f && f.url && (f.vcodec !== 'none' || f.acodec !== 'none'))
      .sort((a, b) => {
        const av = a.vcodec !== 'none' ? 1 : 0;
        const bv = b.vcodec !== 'none' ? 1 : 0;
        if (av !== bv) return bv - av;
        return (b.height || 0) - (a.height || 0) || (b.tbr || b.abr || 0) - (a.tbr || a.abr || 0);
      });

    for (const f of candidates.slice(0, 10)) {
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';
      out.push({
        id: String(f.format_id || 'best'),
        selector: String(f.format_id || 'best'),
        quality: hasVideo ? qualityLabel(f.height) : 'Audio',
        height: f.height || null,
        width: f.width || null,
        fps: f.fps || null,
        codec: hasVideo ? f.vcodec : f.acodec,
        format: f.ext || 'mp4',
        hasAudio,
        fileSize: normalizeSize(f.filesize || f.filesize_approx),
        directUrl: f.url,
        merge: false,
      });
    }
  }

  if (!out.length && info?.url) {
    out.push({
      id: String(info.format_id || 'best'), selector: String(info.format_id || 'best'),
      quality: qualityLabel(info.height), height: info.height || null, width: info.width || null,
      fps: info.fps || null, codec: info.vcodec || info.acodec || null, format: info.ext || 'mp4',
      hasAudio: info.acodec && info.acodec !== 'none', fileSize: normalizeSize(info.filesize || info.filesize_approx),
      directUrl: info.url, merge: false,
    });
  }

  return out;
}

function detectPlatform(info, url) {
  const extractor = String(info?.extractor_key || info?.extractor || '').toLowerCase();
  if (extractor.includes('instagram')) return 'Instagram';
  const host = new URL(url).hostname.toLowerCase();
  return host.includes('youtube') || host.includes('youtu.be') ? 'YouTube' : 'Unknown';
}

function detectType(info) {
  const entries = Array.isArray(info?.entries) ? info.entries.filter(Boolean) : [];
  if (entries.length > 1 || info?._type === 'playlist') return 'carousel';
  const ext = String(info?.ext || '').toLowerCase();
  if (info?.vcodec && info.vcodec !== 'none') return 'video';
  if (info?.acodec && info.acodec !== 'none') return 'audio';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  return 'media';
}

async function analyze(url) {
  const info = await getInfo(url);
  const platform = detectPlatform(info, url);
  if (!['YouTube', 'Instagram'].includes(platform)) throw new Error('Unsupported platform.');
  const entries = Array.isArray(info?.entries) ? info.entries.filter(Boolean) : [];
  const first = entries[0] || info;
  const type = detectType(info);
  const firstFormats = entries.length > 1 ? buildFormats(first, platform.toLowerCase()) : buildFormats(info, platform.toLowerCase());
  const items = entries.length > 1 ? entries.map((entry, i) => ({
    index: i + 1,
    title: entry.title || `Item ${i + 1}`,
    thumbnail: entry.thumbnail || null,
    type: detectType(entry),
    duration: entry.duration || null,
  })) : [];

  return {
    success: true,
    platform,
    type,
    title: info?.title || first?.title || 'Untitled media',
    thumbnail: info?.thumbnail || first?.thumbnail || null,
    duration: info?.duration || first?.duration || null,
    originalResolution: first?.height ? qualityLabel(first.height) : null,
    formats: firstFormats,
    items,
  };
}

function sanitizeFilename(name) {
  return String(name || 'eomeg-media')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, 150) || 'eomeg-media';
}


async function downloadDirectUrlToTemp(mediaUrl, preferredFilename = 'eomeg-media') {
  const dir = tempDir();
  const target = path.join(dir, `${sanitizeFilename(preferredFilename)}.bin`);
  try {
    const response = await fetch(mediaUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36',
        Accept: '*/*',
      },
    });
    if (!response.ok || !response.body) {
      const error = new Error(`Media URL returned HTTP ${response.status}.`);
      error.code = 'DIRECT_MEDIA_FAILED';
      throw error;
    }
    const file = fs.createWriteStream(target, { flags: 'wx' });
    const reader = response.body.getReader();
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_OUTPUT_BYTES) {
          const error = new Error('The generated file is larger than the current limit.');
          error.code = 'OUTPUT_TOO_LARGE';
          throw error;
        }
        if (!file.write(Buffer.from(value))) {
          await new Promise(resolve => file.once('drain', resolve));
        }
      }
    } finally {
      reader.releaseLock();
      file.end();
    }
    await new Promise((resolve, reject) => {
      file.on('finish', resolve);
      file.on('error', reject);
    });

    const contentType = response.headers.get('content-type') || '';
    let urlExtension = 'bin';
    try {
      const pathname = new URL(response.url || mediaUrl).pathname;
      const match = pathname.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
      if (match) urlExtension = match[1].toLowerCase();
    } catch {}
    const extension = contentType.includes('jpeg') ? 'jpg'
      : contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('mp4') ? 'mp4'
      : contentType.includes('quicktime') ? 'mov'
      : contentType.includes('webm') ? 'webm'
      : ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'].includes(urlExtension) ? urlExtension
      : 'bin';
    const finalPath = path.join(dir, `${sanitizeFilename(preferredFilename)}.${extension}`);
    fs.renameSync(target, finalPath);
    return {
      dir,
      filePath: finalPath,
      size: total,
      filename: `${sanitizeFilename(preferredFilename)}.${extension}`,
    };
  } catch (error) {
    cleanup(dir);
    throw error;
  }
}

async function downloadToTemp(url, selector, entryIndex) {
  let info;
  try {
    info = await getInfo(url);
  } catch (error) {
    // Public Instagram pages sometimes remain available when an extractor
    // is temporarily broken. Reuse the public-page metadata approach as a
    // conservative fallback for a single video/image.
    if (isInstagramUrl(url) && !entryIndex) {
      try {
        const og = await fetchInstagramOpenGraph(url);
        const isVideoPage = /video/i.test(String(og.type || '')) || Boolean(og.video);
        const directUrl = og.video || (!isVideoPage ? og.image : null);
        if (directUrl) {
          return await downloadDirectUrlToTemp(
            directUrl,
            og.title || 'eomeg-instagram-media'
          );
        }
      } catch {}
    }
    throw error;
  }
  const entries = Array.isArray(info?.entries) ? info.entries.filter(Boolean) : [];
  if (entries.length > 1 && !entryIndex) {
    const err = new Error('This link contains multiple media items. Select a carousel item first.');
    err.code = 'CAROUSEL_SELECTION_REQUIRED';
    throw err;
  }

  const dir = tempDir();
  const output = path.join(dir, 'media.%(ext)s');
  const args = [
    '--output', output,
    '--no-part', '--no-overwrites', '--no-warnings', '--ignore-config',
    '--retries', '3', '--socket-timeout', '30',
    '--merge-output-format', 'mp4',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:npm',
  ];
  if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  if (entryIndex) args.push('--playlist-items', String(entryIndex));
  else args.push('--no-playlist');
  args.push('--format', selector || 'best', '--', url);

  try {
    await runYtDlp(args);
  } catch (error) {
    cleanup(dir);
    throw error;
  }

  const files = fs.readdirSync(dir)
    .filter(n => !n.endsWith('.part') && !n.endsWith('.ytdl') && n !== 'stdout')
    .map(n => path.join(dir, n))
    .filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });

  if (!files.length) {
    cleanup(dir);
    const err = new Error('No downloadable file was produced.'); err.code = 'NO_OUTPUT'; throw err;
  }

  const filePath = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  const size = fs.statSync(filePath).size;
  if (size > MAX_OUTPUT_BYTES) {
    cleanup(dir);
    const err = new Error('The generated file is larger than the current limit.'); err.code = 'OUTPUT_TOO_LARGE'; throw err;
  }

  const ext = path.extname(filePath).slice(1) || 'mp4';
  return { dir, filePath, size, filename: `${sanitizeFilename(info?.title || 'eomeg-media')}.${ext}` };
}

module.exports = { analyze, downloadToTemp, downloadDirectUrlToTemp, cleanup, buildFormats, detectType, detectPlatform };
