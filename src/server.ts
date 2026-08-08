import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { convertVideoSourceToGifBuffer } from './converter';
import { resolveVideoSourceUrl } from './source-resolver';

const PORT = Math.max(1, Number(process.env.PORT || 8080));
const MAX_INPUT_BYTES = Math.max(1 * 1024 * 1024, Number(process.env.CLIP_WORKER_MAX_INPUT_BYTES || 64 * 1024 * 1024));
const MAX_OUTPUT_BYTES = Math.max(1 * 1024 * 1024, Number(process.env.CLIP_WORKER_MAX_OUTPUT_BYTES || 60 * 1024 * 1024));
const MAX_CONCURRENT_JOBS = Math.max(1, Math.min(4, Number(process.env.CLIP_WORKER_MAX_CONCURRENT_JOBS || 1)));
const SUPPORTED_VIDEO_EXTENSION = /\.(?:mp4|webm|mov|m4v|mkv|avi)$/i;
const SUPPORTED_VIDEO_TYPE = /^(?:video\/|application\/(?:octet-stream|quicktime))/i;

let activeJobs = 0;

function json(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function suppliedSecret(request: IncomingMessage): string {
  const authorization = String(request.headers.authorization || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(request.headers['x-bot-secret'] || '').trim();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request: IncomingMessage): boolean {
  const expected = String(process.env.CLIP_WORKER_SECRET || process.env.DSH_SERVICE_SECRET || '').trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  return safeEqual(suppliedSecret(request), expected);
}

function numberField(form: FormData, name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(form.get(name));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function safeExtension(file: File): string {
  const fromName = extname(file.name || '').toLowerCase();
  if (SUPPORTED_VIDEO_EXTENSION.test(fromName)) return fromName;
  if (file.type === 'video/webm') return '.webm';
  if (file.type === 'video/quicktime') return '.mov';
  return '.mp4';
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const origin = `http://${request.headers.host || 'localhost'}`;
  return new Request(new URL(request.url || '/', origin), {
    method: request.method,
    headers: request.headers as HeadersInit,
    body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function handleConvert(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isAuthorized(request)) {
    json(response, 401, { ok: false, error: 'Unauthorized' });
    return;
  }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INPUT_BYTES + 2 * 1024 * 1024) {
    json(response, 413, { ok: false, error: 'Video upload is too large.' });
    return;
  }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    response.setHeader('Retry-After', '10');
    json(response, 429, { ok: false, error: 'The clip worker is busy. Try again shortly.' });
    return;
  }

  activeJobs += 1;
  let directory = '';
  try {
    const webRequest = await toWebRequest(request);
    const form = await webRequest.formData();
    const fileValue = form.get('file');
    const file = typeof File !== 'undefined' && fileValue instanceof File ? fileValue : null;
    const sourceUrl = String(form.get('sourceUrl') || form.get('url') || '').trim();
    if (!file && !sourceUrl) {
      json(response, 400, { ok: false, error: 'Provide a video file or sourceUrl.' });
      return;
    }

    let source: string;
    let sourceLabel = 'remote-video';
    if (file) {
      if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
        json(response, 413, { ok: false, error: 'Video upload is empty or too large.' });
        return;
      }
      const extension = safeExtension(file);
      if (!SUPPORTED_VIDEO_EXTENSION.test(extension) || (file.type && !SUPPORTED_VIDEO_TYPE.test(file.type))) {
        json(response, 400, { ok: false, error: 'Supported video types: MP4, WebM, MOV, M4V, MKV, and AVI.' });
        return;
      }
      directory = await mkdtemp(join(tmpdir(), 'dsh-upload-'));
      const inputPath = join(directory, `source${extension}`);
      await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
      source = inputPath;
      sourceLabel = file.name || 'uploaded-video';
    } else {
      source = await resolveVideoSourceUrl(sourceUrl);
      sourceLabel = new URL(sourceUrl).hostname;
    }

    const gif = await convertVideoSourceToGifBuffer(source, {
      width: numberField(form, 'width', 480, 160, 960),
      fps: numberField(form, 'fps', 15, 4, 30),
      loop: numberField(form, 'loop', 0, 0, 65_535),
      durationSeconds: numberField(form, 'durationSeconds', 15, 1, 60),
      maxOutputBytes: Math.min(MAX_OUTPUT_BYTES, numberField(form, 'maxOutputBytes', MAX_OUTPUT_BYTES, 1 * 1024 * 1024, MAX_OUTPUT_BYTES)),
      timeoutMs: numberField(form, 'timeoutMs', 90_000, 10_000, 5 * 60_000),
    });

    const filenameStem = sourceLabel
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'converted';
    response.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': String(gif.length),
      'Content-Disposition': `inline; filename="${filenameStem}.gif"`,
      'Cache-Control': 'no-store',
      'X-Clip-Worker': 'dsh-clip-worker',
    });
    response.end(gif);
  } catch (error) {
    console.error('[dsh-clip-worker] conversion failed:', error);
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    json(response, 200, {
      ok: true,
      service: 'dsh-clip-worker',
      activeJobs,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    });
    return;
  }
  if (request.method === 'POST' && (url.pathname === '/v1/gif' || url.pathname === '/convert')) {
    await handleConvert(request, response);
    return;
  }
  json(response, 404, { ok: false, error: 'Not found' });
});

server.requestTimeout = 6 * 60_000;
server.headersTimeout = 30_000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dsh-clip-worker] listening on 0.0.0.0:${PORT}`);
});
