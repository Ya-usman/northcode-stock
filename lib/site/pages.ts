// Pages publiques et langues (refonte de l'accueil, 6 nov. 2026). Une seule liste pour l'en-tête, le menu du téléphone
// et le pied de page. Une page n'apparaît dans la navigation qu'une fois en ligne (`live`) : jamais de lien mort.

export type SitePageKey = 'platform' | 'trades' | 'pricing' | 'help'

export const SITE_PAGES: { key: SitePageKey; path: string; live: boolean }[] = [
  { key: 'platform', path: '/plateforme', live: true },
  { key: 'trades', path: '/metiers', live: false },      // lot C (liste d'attente, migration 217)
  { key: 'pricing', path: '/tarifs', live: true },
  { key: 'help', path: '/aide', live: false },
]
export const livePages = () => SITE_PAGES.filter(p => p.live)
export const isLive = (key: SitePageKey) => SITE_PAGES.some(p => p.key === key && p.live)

// Langues : nom écrit dans sa propre langue. Ajouter une langue = ajouter son fichier messages/<code>.json, son code
// dans i18n.ts et une ligne ici ; au-delà d'environ 8 langues, le choix sur téléphone propose une recherche.
export const SITE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
  { code: 'ha', name: 'Hausa' },
]
export const languageName = (code: string) => SITE_LANGUAGES.find(l => l.code === code)?.name ?? code

/** Même page dans une autre langue (seule la langue en tête du chemin change). */
export function pathInLocale(pathname: string, from: string, to: string): string {
  return pathname.replace(new RegExp(`^/${from}(?=/|$)`), `/${to}`)
}

/** Choix de langue retenu partout : cookie (serveur) et stockage local (application installée), comme dans l'application. */
export function rememberLocale(code: string) {
  try {
    document.cookie = `NEXT_LOCALE=${code};path=/;max-age=31536000;SameSite=Lax`
    localStorage.setItem('NEXT_LOCALE', code)
  } catch { /* stockage indisponible : la langue de l'adresse suffit */ }
}
