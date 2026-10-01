# Eomeg Downloader — Vercel Direct

A Vercel-hosted public-media downloader for YouTube and Instagram. The UI is served as static files and the `/api` routes run on Vercel's Node.js runtime.

## What is included

- Public YouTube videos and Shorts
- YouTube quality detection and selectable resolution
- YouTube video+audio merging through FFmpeg
- Public Instagram Reels/video posts
- Public Instagram image posts where the extractor exposes media
- Supported Instagram carousel items, one item at a time
- Instagram public-page Open Graph fallback for a single video/image when the extractor is temporarily unavailable
- Local browser history and theme UI
- `/api/health` endpoint to verify the bundled binaries after deployment

Only process media you are permitted to download or reuse. No private-account, login, DRM, or access-control bypass is implemented.

## How it works

```text
Browser
  -> /api/analyze
  -> yt-dlp metadata
  -> available formats
  -> /api/download
  -> yt-dlp + FFmpeg
  -> streamed attachment response
```

The YouTube part follows the same core idea as Tyrrrz/YoutubeDownloader: inspect available streams, select a quality, and merge separate audio/video streams with FFmpeg. This implementation uses yt-dlp rather than YoutubeExplode because the same extractor layer also supports Instagram.

## Vercel compatibility

The project uses Node.js 24 and the Node.js Vercel runtime. Vercel currently supports Node.js 24 for builds and functions, and Node.js 20 is being disabled for new deployments on October 1, 2026.

The project bundles the official Linux `yt-dlp` executable during the Vercel build and bundles `ffmpeg-static` with the function. Current yt-dlp documentation says full YouTube support requires `yt-dlp-ejs` and a supported external JavaScript runtime; official standalone binaries bundle the EJS scripts. Node.js 22+ is supported as a JS runtime, so Vercel Node.js 24 is suitable.

The direct download route writes to the function's temporary filesystem and streams the completed file to the browser. This is appropriate for modest public-media jobs, not unlimited long-form media hosting.

### Current function limits

- Hobby: up to 300 seconds
- Pro/Enterprise: up to 800 seconds on the standard Fluid Compute limit
- Eligible Pro/Enterprise projects can opt into an 1800-second beta maximum
- Function request/response body limit is 4.5 MB for buffered payloads; Vercel recommends streaming for larger response bodies
- Function package size is normally limited to 250 MB; eligible Fluid Compute projects can use the Large Functions beta for up to 5 GB

Long downloads can still fail when extraction, transcoding, upstream rate limits, or temporary storage exceed platform limits.

## Deploy

1. Push this folder to GitHub.
2. Import the repository into Vercel.
3. Use Node.js 24.x.
4. Deploy.
5. Open `/api/health` on the deployed site.

The health endpoint reports the detected Node.js, yt-dlp, and FFmpeg versions. For troubleshooting, `/log?url=<public-YouTube-URL>` runs a safe, copyable diagnostics report.

## Local development on Windows/macOS

The bundled binary is Linux-only because Vercel Functions run on Linux. For local development, install yt-dlp locally and set:

```env
YTDLP_PATH=C:\path\to\yt-dlp.exe
```

On Vercel, leave `YTDLP_PATH` unset so the bundled Linux binary is used.

## Environment variables

None are required for the base downloader.

Optional:

```env
YTDLP_PATH=
```

The Magnific upscaling integration is intentionally kept separate from the direct downloader. Add its server-side API key only when the upscaling provider endpoint is configured.

## Important caveats

- YouTube and Instagram extraction behavior can change without notice.
- A URL that works today may require a newer yt-dlp release later.
- Some YouTube formats can be unavailable without the current JS challenge components.
- Private or authentication-required content is not supported.
- For high-volume or very long media processing, use dedicated media infrastructure or object storage instead of treating Vercel as a media server.

## Source reuse

See `THIRD_PARTY_NOTICES.md` for attribution to the Instagram reference repository.
