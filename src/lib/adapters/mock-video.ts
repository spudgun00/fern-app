import type { VideoAdapter, VideoRoom } from './video';

// ============================================================================
// MockVideo: a THROWAWAY DEV STAND-IN for the real video provider (Daily), NOT
// the production integration. Unlike the other mocks it is STATELESS and needs no
// mock_* table: a Daily room is reproducible from its name, so the join URL is
// fully derived from the room ref. The "room" the mock stands in for is an in-app
// page (/consult/room/mock) that plays the role of the embedded Daily call. No
// call content exists to hold. Deleted when the real Daily adapter is wired
// behind the same VideoAdapter interface.
// ============================================================================
export class MockVideo implements VideoAdapter {
  async createRoom(consultRef: string): Promise<VideoRoom> {
    // Derive a stable room ref from the consult ref so the same consult resolves
    // to the same room on both sides (patient + clinician) and across reloads.
    const roomRef = `mockroom-${consultRef}`;
    return { roomRef, joinUrl: this.joinUrl(roomRef) };
  }

  async getRoom(roomRef: string): Promise<VideoRoom | null> {
    if (!roomRef) return null;
    return { roomRef, joinUrl: this.joinUrl(roomRef) };
  }

  private joinUrl(roomRef: string): string {
    return `/consult/room/mock?room=${encodeURIComponent(roomRef)}`;
  }
}
