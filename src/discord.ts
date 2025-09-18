import axios from 'axios';
import FormData from 'form-data';

export interface DiscordPayloadOptions {
  webhookUrl: string;
  file: {
    filename: string;
    contentType: string;
    data: Buffer;
  };
  content: string;
  username?: string;
}

export async function sendGifToDiscord(options: DiscordPayloadOptions): Promise<void> {
  const { webhookUrl, file, content, username } = options;

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      content,
      username,
    })
  );
  form.append('file', file.data, {
    filename: file.filename,
    contentType: file.contentType,
  });

  await axios.post(webhookUrl, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
}
