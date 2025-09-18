import axios from 'axios';

export interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
}

export interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';
const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/token';

export async function getAppAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await axios.post<TwitchTokenResponse>(TWITCH_AUTH_URL, undefined, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    },
  });

  return response.data.access_token;
}

export async function getClipById(clipId: string, token: string, clientId: string): Promise<TwitchClip | null> {
  const response = await axios.get<{ data: TwitchClip[] }>(`${TWITCH_API_BASE}/clips`, {
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
    },
    params: { id: clipId },
  });

  return response.data.data[0] ?? null;
}

export function getClipDownloadUrl(clip: TwitchClip): string {
  const thumbnail = clip.thumbnail_url;
  if (!thumbnail) {
    throw new Error('Clip response does not include a thumbnail URL to derive the download link.');
  }

  const downloadUrl = thumbnail.replace(/-preview-.+?\.jpg/, '.mp4');
  if (!downloadUrl.endsWith('.mp4')) {
    throw new Error(`Unable to derive clip download URL from thumbnail: ${thumbnail}`);
  }

  return downloadUrl;
}
