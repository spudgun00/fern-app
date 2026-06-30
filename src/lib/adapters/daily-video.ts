import type { VideoAdapter, VideoRoom } from './video';

// DailyVideo: the real provider integration, behind the same VideoAdapter
// interface as MockVideo. Calls the Daily REST API directly via fetch — no SDK,
// exactly as the other real adapters. Test mode until go-live.
//
// HARD LINE: this adapter returns only the room name (pointer) and the join URL.
// The call + any recording stay with Daily; the app persists room_ref only. The
// room is created idempotently per consult (createRoom is a no-op if the room
// already exists), so both sides join the same URL.
const DAILY_API = 'https://api.daily.co/v1';

export class DailyVideo implements VideoAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
  ) {
    if (!apiKey) {
      throw new Error('DailyVideo: DAILY_API_KEY is required when VIDEO_IMPL=daily');
    }
    if (!domain) {
      throw new Error('DailyVideo: DAILY_DOMAIN is required when VIDEO_IMPL=daily');
    }
  }

  private async call(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>) {
    const res = await fetch(`${DAILY_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message = (json.info as string | undefined) ?? `HTTP ${res.status}`;
      throw new Error(`DailyVideo ${method} ${path}: ${message}`);
    }
    return json;
  }

  private joinUrl(roomName: string): string {
    return `https://${this.domain}.daily.co/${roomName}`;
  }

  async createRoom(consultRef: string): Promise<VideoRoom> {
    // A stable, consult-scoped room name keeps the room reproducible + idempotent.
    const roomName = `consult-${consultRef}`;
    try {
      await this.call('/rooms', 'POST', {
        name: roomName,
        privacy: 'private',
        properties: { enable_prejoin_ui: true },
      });
    } catch (err) {
      // A room with this name already exists -> reuse it (idempotent). Re-throw
      // anything else.
      if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
    }
    return { roomRef: roomName, joinUrl: this.joinUrl(roomName) };
  }

  async getRoom(roomRef: string): Promise<VideoRoom | null> {
    if (!roomRef) return null;
    try {
      await this.call(`/rooms/${encodeURIComponent(roomRef)}`, 'GET');
    } catch {
      return null;
    }
    return { roomRef, joinUrl: this.joinUrl(roomRef) };
  }
}
