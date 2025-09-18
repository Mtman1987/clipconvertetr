# clipconvertetr

A TypeScript utility script that downloads a Twitch clip, converts it to a GIF using FFmpeg, and posts the GIF to a Discord channel via webhook. The script is designed as a server-friendly workflow that can be integrated into a Node.js/Next.js application later on.

## Prerequisites

- Node.js 18+
- npm

The project relies on `ffmpeg-static` to bundle an FFmpeg binary, so you do not need to install FFmpeg separately.

## Installation

```bash
npm install
```

## Environment variables

Create a `.env` file in the project root (or provide variables through your deployment environment) with the following keys:

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID` | Twitch application client ID. |
| `TWITCH_CLIENT_SECRET` | Twitch application client secret. Used to obtain an app access token. |
| `DISCORD_WEBHOOK_URL` | Discord webhook that will receive the GIF. |
| `TWITCH_CLIP_ID` | (Optional) Default Twitch clip ID to process. |
| `TWITCH_CLIP_URL` | (Optional) Alternative to `TWITCH_CLIP_ID`, accepts a Twitch clip URL. |
| `DISCORD_MESSAGE` | (Optional) Custom message to send with the GIF payload. |
| `GIF_WIDTH` | (Optional) Target GIF width in pixels. Defaults to `480`. |
| `GIF_FPS` | (Optional) Target GIF frame rate. Defaults to `15`. |
| `GIF_LOOP` | (Optional) Number of times the GIF should loop. `0` (default) means loop forever. |
| `GIF_MAX_DURATION_SECONDS` | (Optional) Hard upper bound for the GIF length. When set, only the first `N` seconds are encoded. |

> You can also supply a clip identifier as the first CLI argument instead of setting `TWITCH_CLIP_ID`/`TWITCH_CLIP_URL`.

## Usage

Run the script via `ts-node`:

```bash
npm run start -- <clip-id-or-url>
```

If you prefer to compile to JavaScript first:

```bash
npm run build
node dist/index.js <clip-id-or-url>
```

When executed, the script performs the following steps:

1. Fetches an app access token from Twitch using the client credentials flow.
2. Retrieves the clip metadata from the Twitch Helix API.
3. Derives the downloadable MP4 URL for the clip.
4. Streams the clip through FFmpeg and converts it to a GIF in memory using a server-friendly preset (15 FPS, 480px-wide by default).
5. Uploads the GIF buffer directly to Discord via the configured webhook, along with a contextual message.

## GIF length, looping, and storage

- The script reads the clip duration from Twitch and encodes that full duration into the GIF, so short clips stay short and long clips stay long. Set `GIF_MAX_DURATION_SECONDS` if you want to cap the runtime for exceptionally long clips.
- GIFs are generated with `-loop 0` by default, which tells Discord (and browsers) to loop them forever. Override this with `GIF_LOOP` to control the loop count.
- Generated GIFs never touch the filesystem—they are streamed from Twitch through FFmpeg and uploaded to Discord entirely in memory. This avoids writing to disk, keeps payloads binary (not base64), and plays nicely with serverless hosting that offers little or no persistent storage.

## Notes for integration

- The logic is organised into modular helpers (`twitch`, `converter`, `discord`, and `env`) to make it straightforward to embed into a broader TypeScript/Next.js codebase.
- Because everything is TypeScript-first with no Python dependencies, the script can be moved into a web app or serverless function with minimal changes.
