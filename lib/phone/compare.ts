// Comparaison de numéros de téléphone SANS bibliothèque (léger, utilisable
// partout : recherche, doublons, rattachement en caisse). Deux numéros sont
// considérés identiques si leurs chiffres coïncident une fois le zéro initial
// retiré, ou si l'un (au format international) se termine par la partie
// nationale de l'autre : « 0753309335 » = « +33 7 53 30 93 35 ».

export const phoneDigits = (v: string | null | undefined) => (v || '').replace(/\D/g, '')

/** Partie nationale approximative : chiffres sans zéro(s) initial(aux) */
export const nationalDigits = (v: string | null | undefined) => phoneDigits(v).replace(/^0+/, '')

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a), db = phoneDigits(b)
  if (!da || !db) return false
  if (da === db) return true
  const na = nationalDigits(a), nb = nationalDigits(b)
  if (na === nb) return na.length >= 6
  // L'un porte l'indicatif, l'autre non : la fin doit coïncider sur 7 chiffres au moins
  const [longer, shorter] = na.length >= nb.length ? [na, nb] : [nb, na]
  return shorter.length >= 7 && longer.endsWith(shorter) && longer.length - shorter.length <= 4
}

/** Recherche tolérante : un fragment tapé (« 0753 », « 753 30 ») trouve « +33753309335 » */
export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  const q = nationalDigits(query)
  if (q.length < 3) return false
  return phoneDigits(stored).includes(q)
}

/**
 * Le serveur (fonction de vente, synchronisation hors ligne) ne rattache un
 * client existant que si le numéro envoyé est IDENTIQUE à celui enregistré.
 * Si un client connu a le même numéro sous une autre forme, on renvoie sa
 * forme enregistrée ; sinon le numéro saisi tel quel.
 */
export function resolveStoredPhone<T extends { phone?: string | null }>(typed: string, known: T[]): string {
  const value = typed.trim()
  if (!value) return value
  const match = known.find(c => c.phone && samePhone(c.phone, value))
  return match?.phone || value
}
