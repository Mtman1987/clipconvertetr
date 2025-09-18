import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { PassThrough } from 'stream';

if (!ffmpegStatic) {
  throw new Error('ffmpeg-static was not able to locate a binary for this platform.');
}

ffmpeg.setFfmpegPath(ffmpegStatic);

export interface GifConversionOptions {
  fps?: number;
  width?: number;
  loop?: number;
  durationSeconds?: number;
}

export async function convertClipUrlToGifBuffer(
  clipUrl: string,
  options: GifConversionOptions = {}
): Promise<Buffer> {
  const { fps = 15, width = 480, loop = 0, durationSeconds } = options;
  const buffers: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(clipUrl)
      .outputOptions([
        '-vf',
        `fps=${fps},scale=${width}:-1:flags=lanczos`,
        '-loop',
        String(loop),
      ])
      .toFormat('gif')
      .on('error', (error: Error) => reject(error));

    if (durationSeconds && durationSeconds > 0) {
      command.outputOptions(['-t', durationSeconds.toFixed(3)]);
    }

    const stream = command.pipe(new PassThrough());
    stream.on('data', (chunk) => buffers.push(Buffer.from(chunk)));
    stream.on('end', () => resolve());
    stream.on('error', (error) => reject(error));
  });

  return Buffer.concat(buffers);
}
