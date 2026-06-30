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

  // Mint a per-participant meeting token scoped to this room. Daily PRIVATE rooms
  // (the model we want for a confidential consult) deny the bare room URL; the
  // join URL must carry a `?t=<token>`. Minted per render, so each side gets its
  // own token. Deliberately minimal: room-scoped only. Deferred for go-live (see
  // the external-config checklist): `exp` tied to the appointment window, and
  // `is_owner: true` for the clinician (host controls) -- the latter needs the
  // role passed in, so it is intentionally out of scope here to keep this change
  // contained to the adapter.
  private async mintToken(roomName: string): Promise<string> {
    const json = await this.call('/meeting-tokens', 'POST', {
      properties: { room_name: roomName },
    });
    return String(json.token ?? '');
  }

  private joinUrl(roomName: string, token: string): string {
    return `https://${this.domain}.daily.co/${roomName}?t=${token}`;
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
    const token = await this.mintToken(roomName);
    return { roomRef: roomName, joinUrl: this.joinUrl(roomName, token) };
  }

  async getRoom(roomRef: string): Promise<VideoRoom | null> {
    if (!roomRef) return null;
    try {
      await this.call(`/rooms/${encodeURIComponent(roomRef)}`, 'GET');
    } catch {
      return null;
    }
    const token = await this.mintToken(roomRef);
    return { roomRef, joinUrl: this.joinUrl(roomRef, token) };
  }
}
