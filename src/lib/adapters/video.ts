// The video (Daily) boundary. ALL consult-video operations go through this one
// interface, so the rest of the app stays provider-agnostic (Daily now, Whereby
// or another later) exactly as the other boundaries do. Never branch on the impl
// outside the factory.
//
// HARD LINE (P6): the call itself, and any recording, live with the provider
// (Daily), NEVER in the app DB. This interface surfaces only a room pointer
// (roomRef) and a join URL. No method returns call content. The app DB stores the
// room_ref pointer only; both sides (patient + clinician) join the same room URL.

export interface VideoRoom {
  // Opaque room pointer. Persisted app-side as a pointer only (booking_ref.room_ref).
  roomRef: string;
  // The URL both patient and clinician open to join the consult.
  joinUrl: string;
}

export interface VideoAdapter {
  // Create a room for a consult (keyed by an opaque consult ref so the room is
  // reproducible / idempotent per consult). Returns the room pointer + join URL.
  createRoom(consultRef: string): Promise<VideoRoom>;
  // Resolve an existing room pointer back to its join URL (for the patient room
  // page and the clinician console, which both read room_ref and join).
  getRoom(roomRef: string): Promise<VideoRoom | null>;
}
