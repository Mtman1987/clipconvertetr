import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DIRECT_VIDEO_EXTENSION = /\.(?:mp4|webm|mov|m4v|mkv|avi)(?:$|[?#])/i;

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const version = isIP(normalized);
  if (version === 4) {
    const parts = ipv4Parts(normalized);
    if (!parts) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

export function isDirectVideoUrl(value: string): boolean {
  return DIRECT_VIDEO_EXTENSION.test(value);
}

export async function assertPublicSourceUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Video source must be a valid URL.');
  }

  const allowHttp = String(process.env.CLIP_WORKER_ALLOW_HTTP || '').toLowerCase() === 'true';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('Video source URLs must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Video source URLs cannot contain embedded credentials.');
  }

  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local video source URLs are not allowed.');
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private network video sources are not allowed.');
    return url;
  }

  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('Video source resolved to a private or unavailable network address.');
  }

  return url;
}
