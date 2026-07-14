/**
 * Race a promise against a timeout so a stale connection/session (e.g. after
 * the app sat backgrounded for a while and the JWT/socket went stale) can
 * never leave a save button spinning indefinitely — the caller gets a
 * rejected promise with a clear message instead of hanging forever.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 15_000,
  message = 'Connexion trop lente — réessayez.'
): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

/**
 * Best-effort JWT refresh before a write — bounded so a hung refresh (e.g.
 * right after the tab resumes from background) never blocks the write
 * itself. Failures are swallowed: the write's own withTimeout() is the real
 * safety net, this is just an attempt to avoid an RLS violation from an
 * expired token when it's cheap to do so.
 */
export function refreshSessionBeforeWrite(
  supabase: { auth: { refreshSession: () => PromiseLike<unknown> } },
  ms = 3_000
): Promise<void> {
  return Promise.race([
    Promise.resolve(supabase.auth.refreshSession()),
    new Promise(resolve => setTimeout(resolve, ms)),
  ]).then(() => undefined, () => undefined)
}
