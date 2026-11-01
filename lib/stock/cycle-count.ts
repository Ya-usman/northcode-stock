// Inventaire tournant (étape 14 du Stock, 31 oct. 2026) : quels produits compter cette fois-ci. Règle UNIQUE, pure,
// utilisée par le serveur (suggestion affichée avant de démarrer, puis démarrage).
//   1. jamais comptés d'abord, puis ceux comptés il y a le plus longtemps ;
//   2. à égalité, ceux qui pèsent le plus en valeur (quantité × prix d'achat : sert au classement, jamais affiché) ;
//   3. puis ceux qui se vendent le plus (30 jours) ;
//   4. enfin le nom, pour un ordre stable.
// Produits actifs seulement ; ceux qui ont du stock passent avant ceux à zéro (rien à compter de visible).

export const CYCLE_SIZES = [10, 20, 30] as const
export type CycleSize = (typeof CYCLE_SIZES)[number]
export const DEFAULT_CYCLE_SIZE: CycleSize = 20

export function normalizeCycleSize(v: unknown): CycleSize {
  const n = Number(v)
  return (CYCLE_SIZES as readonly number[]).includes(n) ? (n as CycleSize) : DEFAULT_CYCLE_SIZE
}

export interface CycleCandidate {
  id: string
  name: string
  quantity: number
  /** Valeur au prix d'achat (classement seulement) */
  value: number
  sold30: number
  /** Dernier comptage (ISO) ; null = jamais compté */
  lastCountedAt: string | null
}

export function rankCycleCandidates(list: CycleCandidate[]): CycleCandidate[] {
  const ts = (c: CycleCandidate) => (c.lastCountedAt ? Date.parse(c.lastCountedAt) || 0 : -Infinity)
  return [...list].sort((a, b) =>
    (Number(b.quantity > 0) - Number(a.quantity > 0))
    || (ts(a) - ts(b))
    || (b.value - a.value)
    || (b.sold30 - a.sold30)
    || a.name.localeCompare(b.name))
}

export function pickCycleProducts(list: CycleCandidate[], size: number): CycleCandidate[] {
  return rankCycleCandidates(list).slice(0, Math.max(1, size))
}
