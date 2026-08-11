import { refreshSessionBeforeWrite } from './utils/with-timeout'

let inFlight: Promise<void> | null = null

/**
 * Ensures the Supabase session is fresh — meant to be called at the moment
 * a stale JWT is actually likely (the tab regaining visibility/connectivity
 * after sitting idle, where background refresh timers get throttled), not
 * before every fetch. Bounded to a few seconds, never throws (see
 * refreshSessionBeforeWrite).
 *
 * Concurrent callers share ONE in-flight refresh instead of each firing
 * their own — several pages can react to the same visibilitychange event,
 * and overlapping refreshSession() calls have previously caused a spurious
 * SIGNED_OUT event (see the guard in auth-context.tsx's SIGNED_OUT handler).
 * This dedup makes that structurally impossible from this call site rather
 * than relying on every caller to coordinate by hand.
 */
export function ensureFreshSession(
  supabase: { auth: { refreshSession: () => PromiseLike<unknown> } },
): Promise<void> {
  if (!inFlight) {
    inFlight = refreshSessionBeforeWrite(supabase).finally(() => { inFlight = null })
  }
  return inFlight
}
