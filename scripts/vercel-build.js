const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`)));
  });
}

async function main() {
  if (process.platform === 'linux') {
    await runNode(path.join('scripts', 'install-ytdlp.js'));

    const ffmpegInstall = path.join(root, 'node_modules', 'ffmpeg-static', 'install.js');
    const ffmpegBinary = path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg');

    // Vercel's dependency install can skip third-party install scripts.
    // Run ffmpeg-static's official installer explicitly during our build.
    if (!fs.existsSync(ffmpegBinary)) {
      if (!fs.existsSync(ffmpegInstall)) {
        throw new Error('ffmpeg-static install script is missing.');
      }
      console.log('[Eomeg] Installing ffmpeg-static binary explicitly...');
      await runNode(ffmpegInstall);
    } else {
      console.log('[Eomeg] ffmpeg-static binary already present.');
    }
  }

  const publicDir = path.join(root, 'public');
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });

  for (const name of ['index.html', 'app.js', 'styles.css']) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) throw new Error(`Missing static asset: ${name}`);
    fs.copyFileSync(source, path.join(publicDir, name));
  }

  console.log('[Eomeg] Static output created in /public');
}

main().catch(error => {
  console.error('[Eomeg] Build failed:', error);
  process.exit(1);
});
