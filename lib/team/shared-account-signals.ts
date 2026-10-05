// Règle StockShop (5 oct. 2026) : UN MEMBRE = UNE PERSONNE PHYSIQUE.
// Un compte partagé entre plusieurs personnes détruit la traçabilité (qui a
// vendu, annulé, ajusté le stock…), fausse les quotas et la performance par
// employé. Un APPAREIL partagé est autorisé ; un COMPTE partagé ne l'est pas.
//
// Ce module produit des SIGNAUX NON BLOQUANTS. Il ne refuse jamais rien : un
// vrai nom peut contenir « & », « et », etc. Il sert :
//  - aujourd'hui : à l'avertissement doux de la fenêtre d'invitation ;
//  - plus tard : à une liste admin « comptes potentiellement partagés »
//    (voir docs/ROADMAP.md). Les signaux d'usage (connexions simultanées,
//    appareils, localisations…) pourront s'ajouter au type SharedAccountSignal
//    SANS changer les appelants ; aucun n'est collecté aujourd'hui.

export type SharedAccountSignal =
  /** Le nom désigne un groupe (« Amadou & Mamadou », « Équipe caisse », « Staff Akwa »…) */
  | 'collective_name'
  /** L'e-mail est celui de la boutique ou une adresse de fonction (contact@, caisse@…) */
  | 'shop_email'

// Mots qui désignent un groupe ou une fonction plutôt qu'une personne
const COLLECTIVE_NAME = /(\s&\s|&|\s\+\s|\bet\b|\band\b|\bteam\b|[ée]quipe|\bstaff\b|\bcaisse\b|\bcaissi[eè]re?s\b|\bmagasiniers?\b|\bvendeu(rs|ses)\b|\bboutique\b|\bshop\b|\bstore\b|\bpersonnel\b|\bgroupe?\b)/i
// Adresses de fonction (partie avant @)
const ROLE_EMAIL = /^(contact|info|infos|admin|caisse|caisses|vente|ventes|sales|shop|store|boutique|team|equipe|staff|service|accueil|magasin|stock|compta|gestion)[._-]?\d*$/i

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function sharedAccountSignals(input: { fullName?: string | null; email?: string | null; shopNames?: (string | null | undefined)[] }): SharedAccountSignal[] {
  const out: SharedAccountSignal[] = []
  const name = (input.fullName || '').trim()
  if (name && COLLECTIVE_NAME.test(` ${name} `)) out.push('collective_name')

  const local = (input.email || '').split('@')[0] || ''
  if (local) {
    const l = normalize(local)
    const matchesShop = (input.shopNames || []).some(s => {
      const n = normalize(s || '')
      // Au moins 5 caractères significatifs du nom de la boutique dans l'e-mail
      return n.length >= 5 && (l.includes(n) || n.includes(l) && l.length >= 5)
    })
    if (matchesShop || ROLE_EMAIL.test(local)) out.push('shop_email')
  }
  return out
}
