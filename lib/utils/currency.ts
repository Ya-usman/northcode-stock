import { displayMetaFor, currencySymbol } from '@/lib/saas/currencies'

// ════════════════════════════════════════════════════════════════════════
// FORMATTER CENTRAL DES MONTANTS — StockShop
// ════════════════════════════════════════════════════════════════════════
//
// `formatCurrency(amount, currency, locale?)` est le SEUL point de
// formatage. `currency` accepte, pendant la migration V3 :
//   - un code ISO       ('NGN', 'XAF', 'XOF', 'EUR', …)   ← cible
//   - un symbole legacy ('₦', 'F CFA', 'FCFA', '€', …)    ← toléré (Phase A)
//   - une chaîne inconnue → repli heuristique (ancien comportement)
//
// Les métadonnées (symbole, décimales, position, locale) viennent du
// registre central `lib/saas/currencies.ts` — aucun symbole ni règle CFA
// codés en dur ici.
//
// ⚠️ Ne jamais concaténer manuellement `amount + ' FCFA'` ou `'₦' + amount`
// dans un composant — toujours passer par ce module.

/** @deprecated Utiliser `formatCurrency(x, 'NGN')`. Conservé pour compat. */
export function formatNaira(amount: number | string | null | undefined): string {
  return formatCurrency(amount, 'NGN')
}

/**
 * Formate un montant selon la devise (code ISO de préférence).
 * @param currency  code ISO ('NGN'…) ou symbole legacy ('₦', 'F CFA'…)
 * @param locale    locale d'affichage optionnelle (sépare uniquement les
 *                  décimales ; le regroupement des milliers suit la devise)
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string,
  locale?: string,
): string {
  const num = Number(amount ?? 0)
  const m = displayMetaFor(currency)
  const formatted = num.toLocaleString(locale || m.numberLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: m.decimals,
  })
  return m.symbolPosition === 'after'
    ? `${formatted} ${m.symbol}`
    : `${m.symbol}${formatted}`
}

/**
 * Format for chart Y-axis ticks: 1000 → "1k", 1500000 → "1.5M".
 * @param currency  code ISO ou symbole ; `omitSymbol` = pas de préfixe/suffixe
 */
export function chartTickFormatter(
  v: number,
  currency: string,
  omitSymbol: boolean,
  locale = 'fr',
): string {
  if (v === 0) return '0'
  const m = displayMetaFor(currency)
  const sym = omitSymbol ? '' : m.symbol
  const wrap = (s: string) => (omitSymbol ? s : m.symbolPosition === 'after' ? `${s} ${sym}` : `${sym}${s}`)
  const fmt1 = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 })
  if (v >= 1_000_000_000) return wrap(`${fmt1(v / 1_000_000_000)}Md`)
  if (v >= 1_000_000)     return wrap(`${fmt1(v / 1_000_000)}M`)
  if (v >= 1_000)         return wrap(`${fmt1(v / 1_000)}k`)
  return wrap(String(v))
}

/** Format compact : ₦1.2M, 45.0K F CFA, … */
export function formatNairaCompact(amount: number, currency = 'NGN'): string {
  const m = displayMetaFor(currency)
  const wrap = (s: string) => (m.symbolPosition === 'after' ? `${s} ${m.symbol}` : `${m.symbol}${s}`)
  if (amount >= 1_000_000) return wrap(`${(amount / 1_000_000).toFixed(1)}M`)
  if (amount >= 1_000)     return wrap(`${(amount / 1_000).toFixed(1)}K`)
  return formatCurrency(amount, currency)
}

/**
 * @deprecated Somme naïve NGN vs CFA (fusionne XAF/XOF). À remplacer par
 * une ventilation par devise (`MoneyByCurrency`) — Phase D de la V3.
 * Conservé tel quel pour ne pas casser les 3 pages admin qui l'utilisent.
 */
export function formatAdminRevenue(ngn: number, cfa: number): string {
  const parts: string[] = []
  if (ngn > 0) parts.push(formatCurrency(ngn, 'NGN'))
  if (cfa > 0) parts.push(formatCurrency(cfa, 'XOF'))
  return parts.length > 0 ? parts.join(' | ') : formatCurrency(0, 'NGN')
}

/** Parse une chaîne monétaire vers un nombre (retire symboles + séparateurs). */
export function parseNaira(value: string): number {
  return parseFloat(value.replace(/[₦$€£¥₣,\s]/g, '').replace(/[^\d.-]/g, '')) || 0
}

/**
 * Formate une suite de chiffres bruts pour un champ prix (séparateurs de
 * milliers, sans symbole, sans décimales).
 * @param currency  code ISO ou symbole
 */
export function formatInputValue(rawDigits: string | number, currency: string): string {
  const digits = String(rawDigits ?? '').replace(/\D/g, '')
  if (!digits) return ''
  const num = parseInt(digits, 10)
  if (isNaN(num)) return ''
  const m = displayMetaFor(currency)
  return num.toLocaleString(m.numberLocale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** Réexport pratique — symbole d'affichage d'un code ISO. */
export { currencySymbol }

export function profitMargin(buyingPrice: number, sellingPrice: number): number {
  if (sellingPrice === 0) return 0
  return ((sellingPrice - buyingPrice) / sellingPrice) * 100
}

export function profitAmount(buyingPrice: number, sellingPrice: number): number {
  return sellingPrice - buyingPrice
}
