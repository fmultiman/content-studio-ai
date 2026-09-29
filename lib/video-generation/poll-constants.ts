// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Poller constants that lightweight callers (routes) need without importing
// the whole polling module (MCP SDK, token store, transport).

/** A generation stuck in `queued` with no provider task this long was interrupted mid-submit. */
export const QUEUED_ORPHAN_AGE_MS = 15 * 60_000
