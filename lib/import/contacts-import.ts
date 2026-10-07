// Import des CLIENTS et des FOURNISSEURS (7 oct. 2026) — règles PURES partagées
// par l'aperçu et le serveur (même principe que l'import des produits) :
//  · en-têtes reconnus en fr/en/ha (accents, casse et « * » ignorés) ;
//  · téléphone remis au format international (+237…) avec le pays de la
//    boutique, comme le champ téléphone de l'app ; illisible → à corriger ;
//  · déjà enregistré = même numéro (comparaison tolérante, comme le carnet de
//    la caisse) ou exactement le même nom → laissé tel quel, jamais de doublon ;
//  · doublons dans le fichier signalés (renvoi à la première ligne).
// Lot 2 « reprise de dette » : colonnes facultatives « Montant dû » et « Date de
// la dette ». La dette n'est reprise QUE pour une fiche nouvelle (jamais pour une
// fiche déjà enregistrée : réimporter ne double aucune dette) ; elle devient une
// reprise de dette (Crédits), hors chiffre d'affaires.

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import { samePhone } from '@/lib/phone/compare'
import { normalizeText, parseNumber } from './products-import'

export type ContactKind = 'customers' | 'suppliers'
export type CustomerField = 'name' | 'phone' | 'city' | 'credit_limit' | 'debt' | 'debt_date'
export type SupplierField = 'name' | 'phone' | 'email' | 'city' | 'debt' | 'debt_date'
export const CUSTOMER_FIELDS: CustomerField[] = ['name', 'phone', 'city', 'credit_limit', 'debt', 'debt_date']
export const SUPPLIER_FIELDS: SupplierField[] = ['name', 'phone', 'email', 'city', 'debt', 'debt_date']

const PHONE = ['telephone', 'tel', 'phone', 'numero', 'numero de telephone', 'n° de telephone', 'portable', 'mobile', 'whatsapp', 'contact', 'phone number', 'mobile number', 'lambar waya', 'waya']
const CITY = ['ville', 'city', 'localite', 'quartier', 'adresse', 'town', 'address', 'gari', 'birni']
const DEBT = ['montant du', 'dette', 'dettes', 'dette de depart', 'dette en cours', 'reste a payer', 'reste du', 'solde', 'solde du', 'amount owed', 'owed', 'debt', 'opening balance', 'balance due', 'bashi', 'kudin da ake bi', 'kuɗin da ake bi']
const DEBT_DATE = ['date de la dette', 'date dette', 'date du credit', 'date de la creance', 'depuis le', 'debt date', 'date of debt', 'owed since', 'ranar bashi']
const WORDS: Record<ContactKind, Record<string, string[]>> = {
  customers: {
    name: ['nom', 'nom du client', 'client', 'nom et prenom', 'nom complet', 'name', 'customer', 'customer name', 'full name', 'suna', 'sunan abokin ciniki', 'abokin ciniki'],
    phone: PHONE, city: CITY, debt: DEBT, debt_date: DEBT_DATE,
    credit_limit: ['plafond de credit', 'plafond', 'limite de credit', 'credit max', 'credit maximum', 'credit limit', 'credit ceiling', 'iyakar bashi'],
  },
  suppliers: {
    name: ['nom', 'fournisseur', 'nom du fournisseur', 'raison sociale', 'societe', 'entreprise', 'name', 'supplier', 'supplier name', 'company', 'suna', 'mai samar da kaya', 'sunan mai samar da kaya'],
    phone: PHONE, city: CITY, debt: DEBT, debt_date: DEBT_DATE,
    email: ['email', 'e-mail', 'mail', 'courriel', 'adresse e-mail', 'adresse email', 'adresse mail', 'email address', 'imel', 'adireshin imel'],
  },
}
const INDEX: Record<ContactKind, Map<string, string>> = { customers: new Map(), suppliers: new Map() }
for (const k of ['customers', 'suppliers'] as ContactKind[]) for (const [f, ws] of Object.entries(WORDS[k])) for (const w of ws) INDEX[k].set(normalizeText(w), f)

/** Champ d'un en-tête de colonne pour ce type d'import, ou null */
export function contactHeaderField(kind: ContactKind) {
  return (header: unknown): string | null => {
    const h = normalizeText(header)
    if (!h) return null
    return INDEX[kind].get(h) ?? INDEX[kind].get(h.replace(/\s*\(.*\)\s*$/, '').trim()) ?? null
  }
}

/** Téléphone → format international ; null si vide ; invalid si illisible */
export function parsePhone(v: unknown, country: string | null | undefined): { value: string | null; invalid: boolean } {
  if (v === null || v === undefined) return { value: null, invalid: false }
  const raw = typeof v === 'number' ? String(Math.round(v)) : String(v).trim()
  if (!raw) return { value: null, invalid: false }
  const cc = (country && /^[A-Z]{2}$/.test(country) ? country : undefined) as CountryCode | undefined
  // « 00237… » = « +237… »
  const text = raw.replace(/^00(?=\d)/, '+')
  const p = parsePhoneNumberFromString(text, cc)
  if (p && (p.isValid() || p.isPossible())) return { value: p.number, invalid: false }
  return { value: null, invalid: true }
}

/** Date de la dette : AAAA-MM-JJ (cellule date Excel), JJ/MM/AAAA, JJ-MM-AA, JJ.MM.AAAA, ou numéro de série Excel */
export function parseDebtDate(v: unknown): { value: string | null; invalid: boolean } {
  if (v === null || v === undefined || v === '') return { value: null, invalid: false }
  const ok = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990) return { value: null, invalid: true }
    return { value: dt.toISOString().slice(0, 10), invalid: false }
  }
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return { value: null, invalid: true } // numéro de série Excel (1982 → 2119)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return ok(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = String(v).trim()
  if (!s) return { value: null, invalid: false }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return ok(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  if (/^\d{5}$/.test(s)) return parseDebtDate(Number(s))
  return { value: null, invalid: true }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export type ContactIssue = 'missing_name' | 'name_too_long' | 'invalid_phone' | 'invalid_email' | 'invalid_credit_limit' | 'text_too_long'
  | 'invalid_debt' | 'invalid_debt_date' | 'debt_date_future'
  | 'duplicate_in_file' | 'exists_name' | 'exists_phone' | 'insert_failed'
export interface ContactRecord { name: string; phone: string | null; city: string | null; credit_limit?: number | null; email?: string | null }
export interface ContactReport {
  line: number
  status: 'new' | 'exists' | 'error'
  issue?: ContactIssue
  params?: Record<string, string | number>
  /** ambiguous_number ; dette : debt_not_applied (fiche existante), debt_no_permission, debt_failed */
  warnings: { code: 'ambiguous_number' | 'debt_not_applied' | 'debt_no_permission' | 'debt_failed'; params?: Record<string, string | number> }[]
  record?: ContactRecord
  /** Dette à reprendre (montant > 0) — jamais insérée avec la fiche */
  debt?: { amount: number; date: string | null }
}
export interface ContactRawRow { line: number; values: Record<string, unknown> }

/** Rapport ligne par ligne. existing : fiches actuelles de la boutique (nom, téléphone).
 *  today (AAAA-MM-JJ, UTC) : une date de dette au-delà de demain est refusée (tolérance de fuseau). */
export function checkContactRows(kind: ContactKind, rows: ContactRawRow[], existing: { name: string; phone: string | null }[], country: string | null, today = new Date().toISOString().slice(0, 10)): ContactReport[] {
  const maxDate = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const existingNames = new Map(existing.map(e => [normalizeText(e.name), e.name]))
  const seen: { line: number; name: string; phone: string | null }[] = []

  return rows.map(({ line, values }) => {
    const r: ContactReport = { line, status: 'error', warnings: [] }
    const fail = (issue: ContactIssue, params?: Record<string, string | number>) => Object.assign(r, { status: 'error' as const, issue, params })
    const text = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
    const name = text(values.name)
    if (!name) return fail('missing_name')
    if (name.length > 200) return fail('name_too_long')
    const phone = parsePhone(values.phone, country)
    if (phone.invalid) return fail('invalid_phone', { value: String(values.phone) })
    const city = text(values.city) || null
    if (city && city.length > 120) return fail('text_too_long')
    const rec: ContactRecord = { name, phone: phone.value, city }

    if (kind === 'customers') {
      const lim = parseNumber(values.credit_limit)
      if (lim.invalid || (lim.value !== null && lim.value < 0)) return fail('invalid_credit_limit')
      if (lim.ambiguous) r.warnings.push({ code: 'ambiguous_number', params: { raw: String(values.credit_limit), value: lim.value! } })
      rec.credit_limit = lim.value
    } else {
      const email = text(values.email).toLowerCase() || null
      if (email && !EMAIL_RE.test(email)) return fail('invalid_email', { value: email })
      rec.email = email
    }

    // Dette de départ (facultative) : montant > 0, date pas dans le futur
    const debt = parseNumber(values.debt)
    if (debt.invalid || (debt.value !== null && debt.value < 0)) return fail('invalid_debt', { value: String(values.debt) })
    if (debt.ambiguous) r.warnings.push({ code: 'ambiguous_number', params: { raw: String(values.debt), value: debt.value! } })
    if (debt.value) {
      const d = parseDebtDate(values.debt_date)
      if (d.invalid) return fail('invalid_debt_date', { value: String(values.debt_date) })
      if (d.value && d.value > maxDate) return fail('debt_date_future', { value: d.value })
      r.debt = { amount: Math.round(debt.value * 100) / 100, date: d.value }
    }

    // Doublon dans le fichier : même nom, ou même numéro
    const key = normalizeText(name)
    const first = seen.find(s => s.name === key || (rec.phone && s.phone && samePhone(s.phone, rec.phone)))
    if (first) return fail('duplicate_in_file', { line: first.line })
    seen.push({ line, name: key, phone: rec.phone })

    r.record = rec
    // Déjà enregistré : même numéro (prioritaire), ou exactement le même nom
    const byPhone = rec.phone ? existing.find(e => e.phone && samePhone(e.phone, rec.phone)) : undefined
    const existsAs = byPhone ? { issue: 'exists_phone' as ContactIssue, name: byPhone.name } : existingNames.has(key) ? { issue: 'exists_name' as ContactIssue, name: existingNames.get(key)! } : null
    if (existsAs) {
      // Fiche existante : sa dette n'est pas reprise (réimporter ne double jamais une dette)
      if (r.debt) { r.warnings.push({ code: 'debt_not_applied', params: { amount: r.debt.amount } }); delete r.debt }
      return Object.assign(r, { status: 'exists' as const, issue: existsAs.issue, params: { name: existsAs.name } })
    }
    r.status = 'new'
    return r
  })
}

export function summarizeContacts(reports: ContactReport[]) {
  return {
    total: reports.length,
    new: reports.filter(r => r.status === 'new').length,
    exists: reports.filter(r => r.status === 'exists').length,
    errors: reports.filter(r => r.status === 'error').length,
    ignored: 0,
    warnings: reports.filter(r => r.warnings.length).length,
    /** Dettes qui seront reprises (fiches nouvelles seulement) */
    debts: reports.filter(r => r.status === 'new' && r.debt).length,
    debts_total: reports.filter(r => r.status === 'new' && r.debt).reduce((n, r) => n + r.debt!.amount, 0),
  }
}
