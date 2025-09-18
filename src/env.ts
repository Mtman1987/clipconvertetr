import dotenv from 'dotenv';

dotenv.config();

export interface GifEnvConfig {
  width: number;
  fps: number;
  loop: number;
  maxDurationSeconds?: number;
}

export interface EnvConfig {
  twitchClientId: string;
  twitchClientSecret: string;
  discordWebhookUrl: string;
  clipIdentifier?: string;
  discordMessage?: string;
  gif: GifEnvConfig;
}

const REQUIRED_ENV_VARS = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'DISCORD_WEBHOOK_URL',
] as const;

type RequiredEnvKey = typeof REQUIRED_ENV_VARS[number];

function getEnv(key: RequiredEnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): EnvConfig {
  const config: EnvConfig = {
    twitchClientId: getEnv('TWITCH_CLIENT_ID'),
    twitchClientSecret: getEnv('TWITCH_CLIENT_SECRET'),
    discordWebhookUrl: getEnv('DISCORD_WEBHOOK_URL'),
    clipIdentifier: process.env.TWITCH_CLIP_ID || process.env.TWITCH_CLIP_URL,
    discordMessage: process.env.DISCORD_MESSAGE || process.env.DISCORD_MESSAGE_TEMPLATE,
    gif: {
      width: parsePositiveIntegerEnv('GIF_WIDTH', 480),
      fps: parsePositiveIntegerEnv('GIF_FPS', 15),
      loop: parseNonNegativeIntegerEnv('GIF_LOOP', 0),
      maxDurationSeconds: parsePositiveNumberEnv('GIF_MAX_DURATION_SECONDS'),
    },
  };

  return config;
}

export function extractClipId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Cannot extract clip ID from an empty value');
  }

  try {
    const url = new URL(trimmed);
    const pathnameParts = url.pathname.split('/').filter(Boolean);
    if (url.hostname.includes('clips.twitch.tv')) {
      const last = pathnameParts[pathnameParts.length - 1];
      if (last) {
        return sanitizeClipId(last);
      }
    }

    const clipIndex = pathnameParts.findIndex((segment) => segment.toLowerCase() === 'clip');
    if (clipIndex >= 0 && pathnameParts.length > clipIndex + 1) {
      return sanitizeClipId(pathnameParts[clipIndex + 1]);
    }
  } catch (error) {
    // Not a URL, fall through to slug handling
  }

  return sanitizeClipId(trimmed);
}

function sanitizeClipId(candidate: string): string {
  const match = candidate.match(/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(`Unable to parse clip identifier from input: ${candidate}`);
  }
  return match[1];
}

function parsePositiveIntegerEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`Expected ${key} to be a positive integer, received "${raw}".`);
  }
  return parsed;
}

function parseNonNegativeIntegerEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`Expected ${key} to be a non-negative integer, received "${raw}".`);
  }
  return parsed;
}

function parsePositiveNumberEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected ${key} to be a positive number, received "${raw}".`);
  }
  return parsed;
}
