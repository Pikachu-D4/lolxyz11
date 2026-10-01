const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// Keep this list aligned with TeamPiped's current public-instance directory.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://api-piped.mha.fi',
  'https://piped-api.garudalinux.org',
  'https://api.piped.yt',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
];

const REQUEST_TIMEOUT_MS = 6500;

function extractYouTubeId(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }

    if (host.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const match = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/i);
      return match?.[1] || null;
    }
  } catch {}
  return null;
}

function cleanTitle(value) {
  return String(value || 'YouTube video').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Eomeg-Downloader/1.0',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function parseBytes(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value > 0 ? value : null;

  const s = String(value).trim().replace(/,/g, '');
  const match = s.match(/([0-9.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB)/i);
  if (!match) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    b: 1, kb: 1000, kib: 1024,
    mb: 1000 ** 2, mib: 1024 ** 2,
    gb: 1000 ** 3, gib: 1024 ** 3,
  };
  return n * (multipliers[unit] || 1);
}

function labelFromHeight(height) {
  const h = Number(height) || 0;
  if (h >= 2160) return '2160p';
  if (h >= 1440) return '1440p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  if (h >= 240) return '240p';
  return h ? `${h}p` : 'Video';
}

function mimeToExt(mime, fallback = 'mp4') {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4')) return 'mp4';
  return fallback;
}

function normalizePipedStream(stream, instanceIndex, index) {
  if (!stream?.url || stream.videoOnly) return null;

  const height = Number(stream.height) || null;
  const width = Number(stream.width) || null;
  const mime = stream.mimeType || '';
  const formatName = String(stream.format || '').toUpperCase();
  const ext = mimeToExt(mime, formatName.includes('WEBM') ? 'webm' : 'mp4');

  if (!/^video\/(mp4|webm)/i.test(mime) && !['MPEG_4', 'MP4', 'WEBM'].includes(formatName)) {
    return null;
  }

  return {
    id: `fyt:piped:${instanceIndex}:video:${index}`,
    selector: `fyt:piped:${instanceIndex}:video:${index}`,
    quality: stream.quality || labelFromHeight(height),
    height,
    width,
    fps: Number(stream.fps) || null,
    codec: stream.codec || null,
    format: ext,
    hasAudio: true,
    fileSize: parseBytes(stream.contentLength || stream.fileSize),
    bitrate: Number(stream.bitrate) || 0,
    sourceUrl: stream.url,
  };
}

function normalizeInvidiousStream(stream, instanceIndex, index) {
  if (!stream?.url) return null;

  const qualityLabel = stream.qualityLabel || stream.quality;
  const heightFromResolution = Number(String(stream.resolution || '').match(/(\d+)(?:p|$)/i)?.[1]) || null;
  const height = Number(stream.height) || heightFromResolution || null;
  const width = Number(stream.width) || null;
  const mime = String(stream.type || '').split(';')[0].trim().toLowerCase();
  const ext = String(stream.container || '').toLowerCase() === 'webm'
    ? 'webm'
    : mimeToExt(mime, 'mp4');

  if (!mime.startsWith('video/') && !['mp4', 'webm'].includes(ext)) return null;

  return {
    id: `fyt:inv:${instanceIndex}:format:${index}`,
    selector: `fyt:inv:${instanceIndex}:format:${index}`,
    quality: qualityLabel || labelFromHeight(height),
    height,
    width,
    fps: Number(stream.fps) || null,
    codec: stream.encoding || null,
    format: ext,
    hasAudio: true,
    fileSize: parseBytes(stream.size),
    bitrate: Number(stream.bitrate) || 0,
    sourceUrl: stream.url,
  };
}

async function getPipedInfo(videoId, instanceIndex) {
  const base = PIPED_INSTANCES[instanceIndex];
  const data = await fetchJson(`${base}/streams/${videoId}`);
  const raw = Array.isArray(data?.videoStreams) ? data.videoStreams : [];
  const formats = raw
    .map((stream, index) => normalizePipedStream(stream, instanceIndex, index))
    .filter(Boolean);

  if (!formats.length) throw new Error('Piped returned no progressive video streams.');

  return {
    provider: 'piped',
    instanceIndex,
    base,
    videoId,
    title: cleanTitle(data.title),
    thumbnail: data.thumbnailUrl || null,
    duration: Number(data.duration) || null,
    formats,
  };
}

async function getInvidiousInfo(videoId, instanceIndex) {
  const base = INVIDIOUS_INSTANCES[instanceIndex];
  const data = await fetchJson(`${base}/api/v1/videos/${videoId}?local=true`);
  const raw = Array.isArray(data?.formatStreams) ? data.formatStreams : [];
  const formats = raw
    .map((stream, index) => normalizeInvidiousStream(stream, instanceIndex, index))
    .filter(Boolean);

  if (!formats.length) throw new Error('Invidious returned no progressive video streams.');

  const thumbs = Array.isArray(data.videoThumbnails) ? data.videoThumbnails : [];
  const thumb = [...thumbs]
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0]?.url || null;

  return {
    provider: 'invidious',
    instanceIndex,
    base,
    videoId,
    title: cleanTitle(data.title),
    thumbnail: thumb,
    duration: Number(data.lengthSeconds) || null,
    formats,
  };
}

function dedupeAndSort(formats) {
  const seen = new Set();
  return formats
    .filter(f => f?.sourceUrl)
    .sort((a, b) => {
      const heightDifference = (b.height || 0) - (a.height || 0);
      return heightDifference || ((b.bitrate || 0) - (a.bitrate || 0));
    })
    .filter(f => {
      const key = `${f.height || 0}:${f.format}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeFreeResult(info) {
  const formats = dedupeAndSort(info.formats);
  if (!formats.length) return null;

  return {
    success: true,
    platform: 'YouTube',
    type: 'video',
    title: info.title,
    thumbnail: info.thumbnail,
    duration: info.duration,
    originalResolution: formats[0]?.height ? labelFromHeight(formats[0].height) : null,
    formats,
    items: [],
    provider: 'free-youtube',
  };
}

async function parallelAttempt(jobs, attempts) {
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const normalized = normalizeFreeResult(result.value);
      if (normalized) return normalized;
    } else {
      attempts.push(result.reason?.message || String(result.reason));
    }
  }
  return null;
}

async function analyzeFreeYouTube(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId || videoId.length !== 11) return null;

  const attempts = [];

  // One official/public Piped instance first, then a small parallel fallback set.
  // This keeps the total request window compatible with Vercel Hobby.
  try {
    const first = await getPipedInfo(videoId, 0);
    const normalized = normalizeFreeResult(first);
    if (normalized) return normalized;
  } catch (error) {
    attempts.push(`piped:0 ${error?.message || error}`);
  }

  let normalized = await parallelAttempt(
    [1, 2].map(i => getPipedInfo(videoId, i)),
    attempts
  );
  if (normalized) return normalized;

  normalized = await parallelAttempt(
    [0, 1].map(i => getInvidiousInfo(videoId, i)),
    attempts
  );
  if (normalized) return normalized;

  const error = new Error('Free public YouTube frontends are temporarily unavailable.');
  error.code = 'FREE_YOUTUBE_FAILED';
  error.attempts = attempts;
  throw error;
}

function isFreeYouTubeSelector(selector) {
  return /^fyt:(piped|inv):\d+:(video|format):\d+$/.test(String(selector || ''));
}

function parseSelector(selector) {
  const match = String(selector || '').match(/^fyt:(piped|inv):(\d+):(video|format):(\d+)$/);
  if (!match) return null;
  return {
    provider: match[1],
    instanceIndex: Number(match[2]),
    kind: match[3],
    streamIndex: Number(match[4]),
  };
}

async function resolveSelected(url, selector) {
  const videoId = extractYouTubeId(url);
  const parsed = parseSelector(selector);
  if (!videoId || !parsed) throw new Error('Invalid free YouTube format selection.');

  const info = parsed.provider === 'piped'
    ? await getPipedInfo(videoId, parsed.instanceIndex)
    : await getInvidiousInfo(videoId, parsed.instanceIndex);

  const stream = info.formats.find(f => f.selector === selector);
  if (!stream) throw new Error('The selected free stream is no longer available.');

  return {
    url: stream.sourceUrl,
    filenameBase: info.title,
    extension: stream.format,
    size: stream.fileSize,
    height: stream.height,
    quality: stream.quality,
  };
}

function tempDir() {
  const dir = path.join(os.tmpdir(), `eomeg-freeyt-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadFreeYouTube(url, selector, sanitizeFilename, maxOutputBytes) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error('Invalid YouTube URL.');

  let selected;
  try {
    selected = await resolveSelected(url, selector);
  } catch (error) {
    throw error;
  }

  let response = await fetch(selected.url, {
    redirect: 'follow',
    headers: {
      Accept: '*/*',
      'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/154.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(55000),
  });

  // If the selected provider's signed URL has expired, refresh the same
  // resolution from another free instance rather than going back to YouTube.
  if (!response.ok || !response.body) {
    const targetHeight = Number(selected.height) || 0;
    const alternatives = [];

    for (const i of [0, 1, 2]) {
      try {
        const info = await getPipedInfo(videoId, i);
        const sameHeight = info.formats.filter(f => (f.height || 0) === targetHeight);
        if (sameHeight.length) alternatives.push(
          sameHeight.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]
        );
      } catch {}
    }

    for (const i of [0, 1]) {
      try {
        const info = await getInvidiousInfo(videoId, i);
        const sameHeight = info.formats.filter(f => (f.height || 0) === targetHeight);
        if (sameHeight.length) alternatives.push(
          sameHeight.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]
        );
      } catch {}
    }

    if (!alternatives.length) {
      const error = new Error(`Free stream returned HTTP ${response.status}.`);
      error.code = 'FREE_STREAM_FAILED';
      throw error;
    }

    const alt = alternatives[0];
    selected = {
      url: alt.sourceUrl,
      filenameBase: 'eomeg-youtube',
      extension: alt.format,
      size: alt.fileSize,
      height: alt.height,
      quality: alt.quality,
    };

    response = await fetch(selected.url, {
      redirect: 'follow',
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/154.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(50000),
    });
  }

  if (!response.ok || !response.body) {
    const error = new Error(`Free stream returned HTTP ${response.status}.`);
    error.code = 'FREE_STREAM_FAILED';
    throw error;
  }

  const dir = tempDir();
  const ext = selected.extension === 'webm' ? 'webm' : 'mp4';
  const filename = `${sanitizeFilename(selected.filenameBase)}.${ext}`;
  const filePath = path.join(dir, filename);

  let bytes = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      const size = chunk?.byteLength ?? chunk?.length ?? 0;
      bytes += size;
      if (bytes > maxOutputBytes) {
        const error = new Error('The generated file is larger than the current limit.');
        error.code = 'OUTPUT_TOO_LARGE';
        throw error;
      }
      controller.enqueue(chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(limiter)),
      fs.createWriteStream(filePath, { flags: 'wx' })
    );
    return {
      dir,
      filePath,
      size: bytes,
      filename,
    };
  } catch (error) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

module.exports = {
  extractYouTubeId,
  analyzeFreeYouTube,
  downloadFreeYouTube,
  isFreeYouTubeSelector,
};
