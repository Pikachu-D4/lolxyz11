const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const out = path.resolve(__dirname, '..', 'bin', 'yt-dlp');
// The stable release can lag behind YouTube extractor fixes. The current nightly
// contains newer YouTube client handling, including recent web_embedded fixes.
const url = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux';

if (process.platform !== 'linux') {
  console.log('[Eomeg] Skipping bundled yt-dlp download on non-Linux local development. Set YTDLP_PATH to your local yt-dlp binary.');
  process.exit(0);
}

async function main() {
  if (fs.existsSync(out) && fs.statSync(out).size > 5_000_000) {
    console.log('[Eomeg] yt-dlp binary already present; skipping download.');
    return;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log('[Eomeg] Downloading official yt-dlp nightly Linux binary...');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);

  const tmp = `${out}.tmp`;
  const file = fs.createWriteStream(tmp, { mode: 0o755 });
  await pipeline(Readable.fromWeb(res.body), file);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, out);
  console.log('[Eomeg] yt-dlp installed.');
}

main().catch(error => {
  console.error('[Eomeg] yt-dlp install failed:', error);
  process.exit(1);
});
