/**
 * Race a promise against a timeout so a stale connection/session (e.g. after
 * the app sat backgrounded for a while and the JWT/socket went stale) can
 * never leave a save button spinning indefinitely — the caller gets a
 * rejected promise with a clear message instead of hanging forever.
 */
// Message par défaut dans la langue de la page (préfixe de l'adresse /fr, /en, /ha) : ce message est affiché tel quel
// par ~130 écrans (avant : français écrit en dur, avec un tiret long, lot C des ajouts du 1er nov. 2026)
const SLOW: Record<string, string> = {
  fr: 'Connexion trop lente : vérifiez votre réseau et réessayez.',
  en: 'The connection is too slow: check your network and try again.',
  ha: 'Haɗin intanet yana da jinkiri: duba hanyar sadarwarku kuma ku sake gwadawa.',
}
export function slowConnectionMessage(): string {
  try {
    const lang = (typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : '') || 'fr'
    return SLOW[lang] ?? SLOW.fr
  } catch {
    return SLOW.fr
  }
}

const OFFLINE: Record<string, string> = {
  fr: 'Pas de connexion Internet : rien n’a été enregistré. Réessayez quand le réseau revient.',
  en: 'No internet connection: nothing was saved. Try again when the network is back.',
  ha: 'Babu haɗin intanet: ba a ajiye komai ba. Sake gwadawa idan hanyar sadarwa ta dawo.',
}
/** Erreur d'un envoi → message à montrer : hors ligne ou requête impossible (« Failed to fetch ») = message clair et
 *  traduit ; sinon le message de l'erreur (déjà traduit par le serveur ou par withTimeout). */
export function friendlyNetworkError(err: unknown, fallback?: string): string {
  const lang = (() => { try { return window.location.pathname.split('/')[1] || 'fr' } catch { return 'fr' } })()
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const msg = err instanceof Error ? err.message : ''
  if (offline || (err instanceof TypeError && /fetch|network|load failed/i.test(msg))) return OFFLINE[lang] ?? OFFLINE.fr
  return msg || fallback || SLOW[lang] || SLOW.fr
}

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 15_000,
  message?: string
): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message ?? slowConnectionMessage())), ms)),
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
