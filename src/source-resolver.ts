import puppeteer, { type Browser, type HTTPResponse } from 'puppeteer-core';
import { assertPublicSourceUrl, isDirectVideoUrl } from './source-security';

const MEDIA_CONTENT_TYPE = /^(?:video|application\/(?:octet-stream|vnd\.apple\.mpegurl|x-mpegurl))/i;
const RESOLVE_TIMEOUT_MS = Math.max(5_000, Number(process.env.CLIP_WORKER_BROWSER_TIMEOUT_MS || 25_000));

function chromiumExecutablePath(): string {
  return String(
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROMIUM_PATH ||
    '/usr/bin/chromium',
  ).trim();
}

function isCandidateMediaResponse(response: HTTPResponse): boolean {
  const headers = response.headers();
  const contentType = String(headers['content-type'] || '');
  return MEDIA_CONTENT_TYPE.test(contentType) || isDirectVideoUrl(response.url());
}

async function validateCandidate(value: string): Promise<string | null> {
  try {
    const url = await assertPublicSourceUrl(value);
    return url.toString();
  } catch {
    return null;
  }
}

export async function resolveVideoSourceUrl(input: string): Promise<string> {
  const initial = await assertPublicSourceUrl(input);
  if (isDirectVideoUrl(initial.toString())) return initial.toString();

  let browser: Browser | null = null;
  const candidates = new Set<string>();
  try {
    browser = await puppeteer.launch({
      executablePath: chromiumExecutablePath(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      process.env.CLIP_WORKER_USER_AGENT ||
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    page.on('response', (response) => {
      if (isCandidateMediaResponse(response)) candidates.add(response.url());
    });

    await page.goto(initial.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: RESOLVE_TIMEOUT_MS,
    });
    await page.waitForTimeout(1_000).catch(() => undefined);

    const domCandidates = await page.evaluate(() => {
      const values: string[] = [];
      for (const video of Array.from(document.querySelectorAll('video'))) {
        if (video.currentSrc) values.push(video.currentSrc);
        if (video.src) values.push(video.src);
      }
      for (const source of Array.from(document.querySelectorAll('video source, source[type^="video/"]'))) {
        if ((source as HTMLSourceElement).src) values.push((source as HTMLSourceElement).src);
      }
      const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]');
      const content = ogVideo?.getAttribute('content');
      if (content) values.push(new URL(content, document.baseURI).toString());
      return values;
    });
    for (const candidate of domCandidates) candidates.add(candidate);

    const ranked = [...candidates].sort((left, right) => {
      const directDifference = Number(isDirectVideoUrl(right)) - Number(isDirectVideoUrl(left));
      if (directDifference) return directDifference;
      return left.length - right.length;
    });
    for (const candidate of ranked) {
      const validated = await validateCandidate(candidate);
      if (validated) return validated;
    }

    throw new Error('No playable video source was found on that page.');
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
