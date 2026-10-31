// Phrase « dernière vente » d'un produit sans vente sur 30 jours (étape 15 du Stock, 31 oct. 2026), une seule
// formulation pour la fiche produit et les cartes de la liste. Dates de /api/stock/last-sale (365 jours au plus).
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { LAST_SALE_LOOKBACK_DAYS } from '@/lib/stock/signals'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** Nombre de jours entiers écoulés depuis une date */
export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
}

/**
 * - vente trouvée     « Dernière vente il y a 47 jours »
 * - aucune, produit ajouté il y a moins d'un an   « Aucune vente depuis l'ajout (12 mai) »
 * - aucune, produit plus ancien                   « Aucune vente depuis plus d'un an »
 */
export function lastSaleLabel(t: Translate, locale: string, lastSaleAt: string | null, createdAt?: string | null, now: number = Date.now()): string {
  if (lastSaleAt) return t('products.last_sale_days', { count: daysSince(lastSaleAt, now) })
  if (createdAt && daysSince(createdAt, now) <= LAST_SALE_LOOKBACK_DAYS) {
    const date = new Date(createdAt).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'long' })
    return t('products.last_sale_never', { date })
  }
  return t('products.last_sale_over_year')
}
