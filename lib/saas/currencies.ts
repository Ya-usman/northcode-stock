import { COUNTRIES, getCountry } from './countries'

// ════════════════════════════════════════════════════════════════════════
// SOURCE DE VÉRITÉ CENTRALE DES DEVISES — StockShop V3
// ════════════════════════════════════════════════════════════════════════
//
// La CLÉ MÉTIER est le CODE ISO (`NGN`, `XOF`, `XAF`, `EUR`…) — stable, non
// ambigu (XOF ≠ XAF alors qu'ils partagent le symbole « F CFA »), et
// indépendant de toute chaîne d'affichage. Le symbole ne sert QU'À
// l'affichage, via le formatter central (`lib/utils/currency.ts`).
//
// Migration en cours (V3, progressive) :
//   Phase A — cette couche + `normalizeCurrency()` + formatter compatible
//             (accepte ancien symbole ET code ISO). AUCUNE migration data.
//   Phase B — `shops.currency` symbole → code ISO.
//   Phases C-E — écritures ISO only, nettoyage, contrainte base.
//
// Tant que la Phase B n'est pas faite, `shops.currency` contient encore un
// SYMBOLE pour la plupart des boutiques : toujours passer par
// `normalizeCurrency(value, shop.country)` avant toute logique métier.

export interface CurrencyDef {
  /** Code ISO 4217 — clé métier. */
  code: string
  /** Libellé lisible (admin, sélecteurs). */
  label: string
  /** Symbole d'affichage. */
  symbol: string
  /** Décimales par convention (XAF/XOF = 0, la plupart des autres = 2). */
  decimals: number
  /** Position du symbole relativement au montant. */
  symbolPosition: 'before' | 'after'
  /** Locale de formatage numérique par défaut (séparateurs). */
  numberLocale: string
  /** Pays StockShop utilisant cette devise (codes pays). */
  countries: string[]
  /** Devise proposée / utilisable. */
  active: boolean
}

// Métadonnées par devise. `countries` est complété automatiquement depuis
// COUNTRIES plus bas — ne pas dupliquer la liste ici.
const CURRENCY_META: Record<string, Omit<CurrencyDef, 'code' | 'countries'>> = {
  NGN: { label: 'Naira nigérian',            symbol: '₦',     decimals: 2, symbolPosition: 'before', numberLocale: 'en-NG', active: true },
  XOF: { label: 'Franc CFA BCEAO (Ouest)',   symbol: 'F CFA', decimals: 0, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  XAF: { label: 'Franc CFA BEAC (Centrale)', symbol: 'F CFA', decimals: 0, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  GHS: { label: 'Cedi ghanéen',              symbol: 'GH₵',   decimals: 2, symbolPosition: 'before', numberLocale: 'en-GH', active: true },
  GNF: { label: 'Franc guinéen',             symbol: 'FG',    decimals: 0, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  GMD: { label: 'Dalasi gambien',            symbol: 'D',     decimals: 2, symbolPosition: 'before', numberLocale: 'en-GM', active: true },
  SLE: { label: 'Leone sierra-léonais',      symbol: 'Le',    decimals: 2, symbolPosition: 'before', numberLocale: 'en-SL', active: true },
  LRD: { label: 'Dollar libérien',           symbol: 'L$',    decimals: 2, symbolPosition: 'before', numberLocale: 'en-LR', active: true },
  CVE: { label: 'Escudo cap-verdien',        symbol: 'Esc',   decimals: 0, symbolPosition: 'after',  numberLocale: 'pt-CV', active: true },
  MRU: { label: 'Ouguiya mauritanien',       symbol: 'UM',    decimals: 2, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  CDF: { label: 'Franc congolais',           symbol: 'FC',    decimals: 0, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  EUR: { label: 'Euro',                      symbol: '€',     decimals: 2, symbolPosition: 'after',  numberLocale: 'fr-FR', active: true },
  USD: { label: 'Dollar américain',          symbol: '$',     decimals: 2, symbolPosition: 'before', numberLocale: 'en-US', active: true },
  CAD: { label: 'Dollar canadien',           symbol: 'CA$',   decimals: 2, symbolPosition: 'before', numberLocale: 'en-CA', active: true },
  // Union européenne — pays hors zone euro (devise MÉTIER de la boutique
  // uniquement ; la facturation StockShop reste en EUR pour les 27, voir
  // CountryConfig.billingCurrency dans lib/saas/countries.ts).
  CZK: { label: 'Couronne tchèque',          symbol: 'Kč',    decimals: 2, symbolPosition: 'after',  numberLocale: 'cs-CZ', active: true },
  DKK: { label: 'Couronne danoise',          symbol: 'kr',    decimals: 2, symbolPosition: 'after',  numberLocale: 'da-DK', active: true },
  HUF: { label: 'Forint hongrois',           symbol: 'Ft',    decimals: 2, symbolPosition: 'after',  numberLocale: 'hu-HU', active: true },
  PLN: { label: 'Zloty polonais',            symbol: 'zł',    decimals: 2, symbolPosition: 'after',  numberLocale: 'pl-PL', active: true },
  RON: { label: 'Leu roumain',               symbol: 'lei',   decimals: 2, symbolPosition: 'after',  numberLocale: 'ro-RO', active: true },
  SEK: { label: 'Couronne suédoise',         symbol: 'kr',    decimals: 2, symbolPosition: 'after',  numberLocale: 'sv-SE', active: true },
  // Nouveaux pays (tarification du 3 nov. 2026) — miroir de shops_currency_supported (migration 207)
  KES: { label: 'Shilling kényan'           , symbol: 'KSh'  , decimals: 2, symbolPosition: 'before', numberLocale: 'en-KE', active: true },
  UGX: { label: 'Shilling ougandais'        , symbol: 'USh'  , decimals: 0, symbolPosition: 'before', numberLocale: 'en-UG', active: true },
  TZS: { label: 'Shilling tanzanien'        , symbol: 'TSh'  , decimals: 0, symbolPosition: 'before', numberLocale: 'en-TZ', active: true },
  RWF: { label: 'Franc rwandais'            , symbol: 'FRw'  , decimals: 0, symbolPosition: 'before', numberLocale: 'en-RW', active: true },
  ETB: { label: 'Birr éthiopien'            , symbol: 'Br'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-ET', active: true },
  MAD: { label: 'Dirham marocain'           , symbol: 'DH'   , decimals: 2, symbolPosition: 'after',  numberLocale: 'fr-MA', active: true },
  TND: { label: 'Dinar tunisien'            , symbol: 'DT'   , decimals: 3, symbolPosition: 'after',  numberLocale: 'fr-TN', active: true },
  DZD: { label: 'Dinar algérien'            , symbol: 'DA'   , decimals: 2, symbolPosition: 'after',  numberLocale: 'fr-DZ', active: true },
  EGP: { label: 'Livre égyptienne'          , symbol: 'E£'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-EG', active: true },
  ZAR: { label: 'Rand sud-africain'         , symbol: 'R'    , decimals: 2, symbolPosition: 'before', numberLocale: 'en-ZA', active: true },
  INR: { label: 'Roupie indienne'           , symbol: '₹'    , decimals: 2, symbolPosition: 'before', numberLocale: 'en-IN', active: true },
  PKR: { label: 'Roupie pakistanaise'       , symbol: 'Rs'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-PK', active: true },
  BDT: { label: 'Taka bangladais'           , symbol: '৳'    , decimals: 2, symbolPosition: 'before', numberLocale: 'en-BD', active: true },
  PHP: { label: 'Peso philippin'            , symbol: '₱'    , decimals: 2, symbolPosition: 'before', numberLocale: 'en-PH', active: true },
  IDR: { label: 'Roupie indonésienne'       , symbol: 'Rp'   , decimals: 0, symbolPosition: 'before', numberLocale: 'id-ID', active: true },
  VND: { label: 'Dong vietnamien'           , symbol: '₫'    , decimals: 0, symbolPosition: 'after',  numberLocale: 'vi-VN', active: true },
  NPR: { label: 'Roupie népalaise'          , symbol: 'Rs'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-NP', active: true },
  LKR: { label: 'Roupie srilankaise'        , symbol: 'Rs'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-LK', active: true },
  KHR: { label: 'Riel cambodgien'           , symbol: '៛'    , decimals: 0, symbolPosition: 'after',  numberLocale: 'km-KH', active: true },
  MMK: { label: 'Kyat birman'               , symbol: 'K'    , decimals: 0, symbolPosition: 'before', numberLocale: 'en-US', active: true },
  CNY: { label: 'Yuan chinois'              , symbol: '¥'    , decimals: 2, symbolPosition: 'before', numberLocale: 'zh-CN', active: true },
  MYR: { label: 'Ringgit malaisien'         , symbol: 'RM'   , decimals: 2, symbolPosition: 'before', numberLocale: 'ms-MY', active: true },
  THB: { label: 'Baht thaïlandais'          , symbol: '฿'    , decimals: 2, symbolPosition: 'before', numberLocale: 'th-TH', active: true },
  JPY: { label: 'Yen japonais'              , symbol: '¥'    , decimals: 0, symbolPosition: 'before', numberLocale: 'ja-JP', active: true },
  KRW: { label: 'Won sud-coréen'            , symbol: '₩'    , decimals: 0, symbolPosition: 'before', numberLocale: 'ko-KR', active: true },
  SGD: { label: 'Dollar de Singapour'       , symbol: 'S$'   , decimals: 2, symbolPosition: 'before', numberLocale: 'en-SG', active: true },
  AED: { label: 'Dirham des Émirats'        , symbol: 'AED'  , decimals: 2, symbolPosition: 'before', numberLocale: 'en-AE', active: true },
  SAR: { label: 'Riyal saoudien'            , symbol: 'SAR'  , decimals: 2, symbolPosition: 'before', numberLocale: 'en-SA', active: true },
  BRL: { label: 'Réal brésilien'            , symbol: 'R$'   , decimals: 2, symbolPosition: 'before', numberLocale: 'pt-BR', active: true },
  MXN: { label: 'Peso mexicain'             , symbol: 'MX$'  , decimals: 2, symbolPosition: 'before', numberLocale: 'es-MX', active: true },
  CLP: { label: 'Peso chilien'              , symbol: 'CLP'  , decimals: 0, symbolPosition: 'before', numberLocale: 'es-CL', active: true },
  COP: { label: 'Peso colombien'            , symbol: 'COP'  , decimals: 0, symbolPosition: 'before', numberLocale: 'es-CO', active: true },
  PEN: { label: 'Sol péruvien'              , symbol: 'S/'   , decimals: 2, symbolPosition: 'before', numberLocale: 'es-PE', active: true },
  ARS: { label: 'Peso argentin'             , symbol: 'AR$'  , decimals: 2, symbolPosition: 'before', numberLocale: 'es-AR', active: true },
  UYU: { label: 'Peso uruguayen'            , symbol: 'UY$'  , decimals: 2, symbolPosition: 'before', numberLocale: 'es-UY', active: true },
  CRC: { label: 'Colón costaricien'         , symbol: '₡'    , decimals: 0, symbolPosition: 'before', numberLocale: 'es-CR', active: true },
  BOB: { label: 'Boliviano'                 , symbol: 'Bs'   , decimals: 2, symbolPosition: 'before', numberLocale: 'es-BO', active: true },
  GTQ: { label: 'Quetzal guatémaltèque'     , symbol: 'Q'    , decimals: 2, symbolPosition: 'before', numberLocale: 'es-GT', active: true },
  HNL: { label: 'Lempira hondurien'         , symbol: 'L'    , decimals: 2, symbolPosition: 'before', numberLocale: 'es-HN', active: true },
  HTG: { label: 'Gourde haïtienne'          , symbol: 'G'    , decimals: 2, symbolPosition: 'after',  numberLocale: 'fr-HT', active: true },
  VES: { label: 'Bolivar vénézuélien'       , symbol: 'Bs.'  , decimals: 2, symbolPosition: 'before', numberLocale: 'es-VE', active: true },
  GBP: { label: 'Livre sterling'            , symbol: '£'    , decimals: 2, symbolPosition: 'before', numberLocale: 'en-GB', active: true },
  CHF: { label: 'Franc suisse'              , symbol: 'CHF'  , decimals: 2, symbolPosition: 'before', numberLocale: 'de-CH', active: true },
}

function buildRegistry(): Record<string, CurrencyDef> {
  const countriesByCode: Record<string, string[]> = {}
  for (const c of Object.values(COUNTRIES)) {
    ;(countriesByCode[c.currency] ??= []).push(c.code)
  }
  const out: Record<string, CurrencyDef> = {}
  for (const [code, meta] of Object.entries(CURRENCY_META)) {
    out[code] = { code, ...meta, countries: countriesByCode[code] ?? [] }
  }
  return out
}

/** Registre central, indexé par code ISO. */
export const CURRENCIES: Record<string, CurrencyDef> = buildRegistry()

/** Liste triée par libellé (sélecteurs admin). */
export const CURRENCY_LIST: CurrencyDef[] = Object.values(CURRENCIES).sort((a, b) =>
  a.label.localeCompare(b.label, 'fr'),
)

/** Codes ISO de toutes les devises supportées. */
export const SUPPORTED_CURRENCY_CODES: string[] = Object.keys(CURRENCIES)

const SUPPORTED_CODES = new Set(SUPPORTED_CURRENCY_CODES)

// ── Résolution symbole → code(s) ────────────────────────────────────────
// Symboles NON ambigus → un seul code. « F CFA » (et variantes) est
// ambigu XAF/XOF : géré séparément dans normalizeCurrency via le pays.
const CODE_BY_SYMBOL: Record<string, string> = {}
for (const def of Object.values(CURRENCIES)) {
  // le 1er code rencontré pour un symbole donné gagne ; les cas ambigus
  // (F CFA) sont écartés juste après.
  if (!(def.symbol in CODE_BY_SYMBOL)) CODE_BY_SYMBOL[def.symbol] = def.code
}
delete CODE_BY_SYMBOL['F CFA'] // ambigu — jamais résolu sans pays
delete CODE_BY_SYMBOL['kr']    // ambigu DKK/SEK — aucune des deux n'a de code
                                // pays fiable comme le CFA ; on préfère un
                                // repli `null` (anomalie) à un mauvais choix
                                // silencieux. Aucune donnée existante n'utilise
                                // ce symbole brut (DKK/SEK arrivent toujours en
                                // code ISO depuis l'app).

/** Variantes historiques d'un symbole ambigu « franc CFA ». */
const CFA_SYMBOLS = new Set(['F CFA', 'FCFA', 'CFA', 'FRS CFA', 'FR CFA'])

export function isSupportedCurrencyCode(code: string | null | undefined): boolean {
  return !!code && SUPPORTED_CODES.has(code)
}

/**
 * `true` si la valeur désigne un franc CFA (code XAF/XOF **ou** un ancien
 * symbole). Utile pour les regroupements admin tolérants pendant la
 * transition V3 — évite un `.includes('CFA')` dispersé (§29).
 */
export function isFrancCfaCurrency(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  return v === 'XAF' || v === 'XOF' || CFA_SYMBOLS.has(v)
}

/** Métadonnées d'une devise par code ISO (repli : NGN). */
export function getCurrency(code: string | null | undefined): CurrencyDef {
  return (code && CURRENCIES[code]) || CURRENCIES.NGN
}

/** Symbole d'affichage pour un code ISO — ou renvoie l'entrée telle quelle
 *  si c'est déjà un symbole / inconnu (compat transition). */
export function currencySymbol(codeOrSymbol: string | null | undefined): string {
  if (!codeOrSymbol) return ''
  if (CURRENCIES[codeOrSymbol]) return CURRENCIES[codeOrSymbol].symbol
  return codeOrSymbol
}

const META_BY_SYMBOL: Record<string, Omit<CurrencyDef, 'code' | 'countries'>> = {}
for (const def of Object.values(CURRENCIES)) {
  if (!(def.symbol in META_BY_SYMBOL)) META_BY_SYMBOL[def.symbol] = def
}

/**
 * Métadonnées d'affichage pour n'importe quelle entrée devise : code ISO,
 * symbole connu, variante CFA, ou chaîne inconnue (repli heuristique — même
 * comportement que l'ancien formatter). Utilisé par `formatCurrency`.
 */
export function displayMetaFor(
  codeOrSymbol: string | null | undefined,
): Pick<CurrencyDef, 'symbol' | 'decimals' | 'symbolPosition' | 'numberLocale'> {
  const raw = (codeOrSymbol ?? '').trim()
  if (!raw) return CURRENCIES.NGN
  if (CURRENCIES[raw]) return CURRENCIES[raw]
  if (CURRENCIES[raw.toUpperCase()]) return CURRENCIES[raw.toUpperCase()]
  if (CFA_SYMBOLS.has(raw)) return CURRENCIES.XOF // XAF/XOF partagent l'affichage
  if (META_BY_SYMBOL[raw]) return META_BY_SYMBOL[raw]
  // Inconnu : replique l'ancienne heuristique (symbole long = suffixe).
  return {
    symbol: raw,
    decimals: 2,
    symbolPosition: raw.length > 2 ? 'after' : 'before',
    numberLocale: raw.includes('CFA') ? 'fr-FR' : 'en-US',
  }
}

/** Code ISO de la devise par défaut d'un pays (`getCountry` fait foi). */
export function currencyCodeForCountry(countryCode: string | null | undefined): string {
  return getCountry(countryCode || 'NG').currency
}

/**
 * Normalise une valeur devise (ancien symbole, variante CFA, ou code ISO)
 * vers un CODE ISO canonique. Cœur de la compatibilité transitoire V3.
 *
 *   normalizeCurrency('NGN')                 → 'NGN'
 *   normalizeCurrency('₦')                   → 'NGN'
 *   normalizeCurrency('F CFA', 'CM')         → 'XAF'
 *   normalizeCurrency('FCFA', 'SN')          → 'XOF'
 *   normalizeCurrency('F CFA')               → null   (ambigu, pas de pays)
 *   normalizeCurrency('???', 'CM')           → null   (entrée non reconnue)
 *
 * STRICTE : ne « devine » jamais depuis le seul pays si l'entrée est
 * inconnue (c'est le rôle de `resolveCurrencyCode`). Renvoie `null` =
 * anomalie à tracer / à rejeter.
 */
export function normalizeCurrency(
  value: string | null | undefined,
  country?: string | null,
): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  // 1. Déjà un code ISO supporté ?
  const upper = raw.toUpperCase()
  if (SUPPORTED_CODES.has(upper)) return upper

  // 2. Symbole « franc CFA » (ambigu) → départage UNIQUEMENT par le pays
  if (CFA_SYMBOLS.has(raw) || CFA_SYMBOLS.has(upper)) {
    if (country) {
      const iso = currencyCodeForCountry(country)
      if (iso === 'XAF' || iso === 'XOF') return iso
    }
    return null // ambigu sans pays fiable — anomalie
  }

  // 3. Symbole non ambigu connu
  if (CODE_BY_SYMBOL[raw]) return CODE_BY_SYMBOL[raw]

  return null
}

/**
 * Comme `normalizeCurrency` mais ne renvoie jamais `null` : retombe sur le
 * pays puis sur NGN. À utiliser pour l'AFFICHAGE (jamais pour une décision
 * métier sensible, où un `null` doit être traité comme une anomalie).
 */
export function resolveCurrencyCode(
  value: string | null | undefined,
  country?: string | null,
): string {
  return normalizeCurrency(value, country) ?? currencyCodeForCountry(country) ?? 'NGN'
}

// ── Rétro-compat V2 (module Parrainage) — ne pas retirer avant nettoyage ─
export interface CurrencyRef { code: string; symbol: string; label: string }
/** @deprecated V2 — utiliser CURRENCY_LIST. Conservé pour le module Parrainage. */
export const REFERRAL_CURRENCIES: CurrencyRef[] = CURRENCY_LIST.map((c) => ({
  code: c.code,
  symbol: c.symbol,
  label: `${c.label} — ${c.code} (${c.symbol})`,
}))
