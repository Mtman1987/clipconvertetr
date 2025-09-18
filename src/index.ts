import { convertClipUrlToGifBuffer } from './converter';
import { loadConfig, extractClipId } from './env';
import { getAppAccessToken, getClipById, getClipDownloadUrl } from './twitch';
import { sendGifToDiscord } from './discord';

async function main() {
  const config = loadConfig();
  const clipIdentifier = process.argv[2] || config.clipIdentifier;

  if (!clipIdentifier) {
    throw new Error('Please provide a Twitch clip ID or URL via CLI argument or TWITCH_CLIP_ID/TWITCH_CLIP_URL env variable.');
  }

  const clipId = extractClipId(clipIdentifier);
  console.log(`Fetching Twitch clip ${clipId}...`);

  const token = await getAppAccessToken(config.twitchClientId, config.twitchClientSecret);
  const clip = await getClipById(clipId, token, config.twitchClientId);
  if (!clip) {
    throw new Error(`No clip found for ID ${clipId}`);
  }

  const downloadUrl = getClipDownloadUrl(clip);
  const clipDurationSeconds = clip.duration;
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
    throw new Error(`Clip ${clipId} returned an invalid duration: ${clipDurationSeconds}`);
  }

  console.log(`Clip duration: ${clipDurationSeconds.toFixed(2)} seconds.`);

  const effectiveDuration = config.gif.maxDurationSeconds
    ? Math.min(clipDurationSeconds, config.gif.maxDurationSeconds)
    : clipDurationSeconds;

  if (config.gif.maxDurationSeconds && clipDurationSeconds > config.gif.maxDurationSeconds) {
    console.warn(
      `Clip duration exceeds GIF_MAX_DURATION_SECONDS (${config.gif.maxDurationSeconds}s). ` +
        `Only the first ${effectiveDuration.toFixed(2)} seconds will be included in the GIF.`
    );
  }
  console.log('Converting clip to GIF in-memory...');
  const gifBuffer = await convertClipUrlToGifBuffer(downloadUrl, {
    fps: config.gif.fps,
    width: config.gif.width,
    loop: config.gif.loop,
    durationSeconds: effectiveDuration,
  });

  const message = config.discordMessage ?? `🎬 **${clip.title}** by ${clip.creator_name} — ${clip.url}`;

  console.log('Sending GIF to Discord webhook...');
  await sendGifToDiscord({
    webhookUrl: config.discordWebhookUrl,
    file: {
      filename: `${clipId}.gif`,
      contentType: 'image/gif',
      data: gifBuffer,
    },
    content: message,
  });

  console.log('GIF uploaded to Discord successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
