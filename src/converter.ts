import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!ffmpegStatic) {
  throw new Error('ffmpeg-static was not able to locate a binary for this platform.');
}

export interface GifConversionOptions {
  fps?: number;
  width?: number;
  loop?: number;
  durationSeconds?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

type ConversionProfile = {
  fps: number;
  width: number;
  colors: number;
};

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function conversionProfiles(options: GifConversionOptions): ConversionProfile[] {
  const requestedFps = clampInteger(options.fps, 15, 4, 30);
  const requestedWidth = clampInteger(options.width, 480, 160, 960);
  return [
    { fps: requestedFps, width: requestedWidth, colors: 160 },
    { fps: Math.min(requestedFps, 12), width: Math.min(requestedWidth, 420), colors: 128 },
    { fps: Math.min(requestedFps, 10), width: Math.min(requestedWidth, 360), colors: 96 },
    { fps: Math.min(requestedFps, 8), width: Math.min(requestedWidth, 300), colors: 80 },
  ].filter((profile, index, all) => (
    all.findIndex((candidate) => (
      candidate.fps === profile.fps &&
      candidate.width === profile.width &&
      candidate.colors === profile.colors
    )) === index
  ));
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic as string, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`FFmpeg conversion exceeded ${Math.ceil(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const outcome = signal || String(code ?? 'unknown');
      reject(new Error(`FFmpeg failed (${outcome}): ${stderr.trim().slice(-2_000)}`));
    });
  });
}

async function convertWithProfile(
  source: string,
  outputPath: string,
  profile: ConversionProfile,
  options: GifConversionOptions,
): Promise<Buffer> {
  const loop = clampInteger(options.loop, 0, 0, 65_535);
  const timeoutMs = clampInteger(options.timeoutMs, 90_000, 10_000, 5 * 60_000);
  const duration = Number(options.durationSeconds);
  const filter = [
    `[0:v]fps=${profile.fps},scale='min(${profile.width},iw)':-2:flags=lanczos,split[s0][s1]`,
    `[s0]palettegen=max_colors=${profile.colors}:stats_mode=diff[p]`,
    '[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  ].join(';');
  const remoteInputOptions = /^https?:\/\//i.test(source)
    ? ['-user_agent', process.env.CLIP_WORKER_USER_AGENT || 'dsh-clip-worker/1.0']
    : [];

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    ...remoteInputOptions,
    '-i', source,
    ...(Number.isFinite(duration) && duration > 0 ? ['-t', Math.min(duration, 60).toFixed(3)] : []),
    '-an',
    '-filter_complex', filter,
    '-loop', String(loop),
    '-gifflags', '+transdiff',
    outputPath,
  ];

  await runFfmpeg(args, timeoutMs);
  return readFile(outputPath);
}

export async function convertVideoSourceToGifBuffer(
  source: string,
  options: GifConversionOptions = {},
): Promise<Buffer> {
  const maxOutputBytes = clampInteger(options.maxOutputBytes, 60 * 1024 * 1024, 1 * 1024 * 1024, 100 * 1024 * 1024);
  const directory = await mkdtemp(join(tmpdir(), 'dsh-gif-'));
  const outputPath = join(directory, 'converted.gif');
  let lastSize = 0;
  let lastError: unknown;

  try {
    for (const profile of conversionProfiles(options)) {
      try {
        const result = await convertWithProfile(source, outputPath, profile, options);
        lastSize = result.length;
        if (result.length <= maxOutputBytes) return result;
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  if (lastError && !lastSize) throw lastError;
  throw new Error(`Converted GIF is ${Math.ceil(lastSize / 1024 / 1024)} MB, above the ${Math.floor(maxOutputBytes / 1024 / 1024)} MB limit.`);
}

export async function convertClipUrlToGifBuffer(
  clipUrl: string,
  options: GifConversionOptions = {},
): Promise<Buffer> {
  return convertVideoSourceToGifBuffer(clipUrl, options);
}
