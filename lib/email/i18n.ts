// Langue des e-mails CLIENTS : celle enregistrée par le destinataire
// (profiles.locale), français à défaut. Textes : namespace « emails » de
// messages/{fr,en,ha}.json. Le bilan du matin (administrateurs) reste en français.

import { getLocaleTranslator, normalizeLocale } from '@/lib/api/i18n'

export type EmailLocale = 'fr' | 'en' | 'ha'

const DATE_LOCALE: Record<EmailLocale, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }

export interface EmailI18n {
  locale: EmailLocale
  /** Traduction d'une clé du namespace « emails » (ex. « owner_alerts.button ») */
  t: (key: string, values?: Record<string, string | number>) => string
  /** Date mise en forme dans la langue (fuseau optionnel) */
  date: (d: Date | string, opts: Intl.DateTimeFormatOptions, timeZone?: string) => string
  /** Nombre mis en forme dans la langue */
  num: (n: number) => string
}

export function emailI18n(raw: string | null | undefined): EmailI18n {
  const locale = normalizeLocale(raw) as EmailLocale
  const tr = getLocaleTranslator(locale, 'emails') as any
  const dl = DATE_LOCALE[locale]
  return {
    locale,
    t: (key, values) => tr(key, values),
    date: (d, opts, timeZone) => {
      const x = typeof d === 'string' ? new Date(d) : d
      try { return x.toLocaleDateString(dl, { ...opts, ...(timeZone ? { timeZone } : {}) }) } catch { return x.toLocaleDateString('fr-FR', { ...opts, ...(timeZone ? { timeZone } : {}) }) }
    },
    num: n => Math.round(n).toLocaleString(dl),
  }
}

/** Libellé d'un mode de paiement dans la langue de l'e-mail */
export function methodLabel(i: EmailI18n, method: string): string {
  const known = ['cash', 'mobile_money', 'wave', 'transfer', 'pos', 'card', 'credit', 'mixed', 'paystack', 'other']
  return known.includes(method) ? i.t(`methods.${method}`) : method
}
