// Messages du support aux commerçants qui débutent (Admin → Activation) —
// fonctions PURES : modèle conseillé selon la situation du compte, texte prêt
// à l'envoi dans la langue du commerçant (emails.support_contact), mise en
// forme de l'e-mail. Le texte reste modifiable avant l'envoi : l'e-mail est
// construit à partir de ce que le support a validé.

import { esc, emailShell } from '@/lib/email/brand'
import type { EmailI18n } from '@/lib/email/i18n'

export type SupportTemplate = 'welcome_product' | 'late_product' | 'first_sale' | 'free'
export const SUPPORT_TEMPLATES: SupportTemplate[] = ['welcome_product', 'late_product', 'first_sale', 'free']
export type SupportChannel = 'email' | 'whatsapp'

export const SUPPORT_EMAIL = 'support@stockshop.tech'
/** Pas de 2e message sans confirmation avant ce délai ; la relance automatique attend aussi */
export const RECONTACT_GAP_MS = 2 * 86_400_000
export const SUBJECT_MAX = 150
export const BODY_MAX = 4000

/** Modèle conseillé : aucun produit (récent / plus ancien), sinon première vente */
export function recommendedTemplate(a: { ageDays: number; hasProduct: boolean }): SupportTemplate {
  if (!a.hasProduct) return a.ageDays <= 3 ? 'welcome_product' : 'late_product'
  return 'first_sale'
}

/** Lien qui ouvre l'app directement dans le bon tour guidé */
export function templateLink(t: SupportTemplate, appUrl: string, locale: string): string | null {
  if (t === 'welcome_product' || t === 'late_product') return `${appUrl}/${locale}/stock/products?tour=add_product`
  if (t === 'first_sale') return `${appUrl}/${locale}/sales/new?tour=first_sale`
  return null
}

export interface SupportDraft { subject: string; body: string; link: string | null; cta: string | null }

/** Texte complet prêt à l'envoi : salutation, message, signature (prénom du membre du support) */
export function buildSupportDraft(i: EmailI18n, t: SupportTemplate, p: { ownerName: string | null; shopName: string; sender: string; appUrl: string }): SupportDraft {
  const k = (key: string, v?: Record<string, string | number>) => i.t(`support_contact.${key}`, v)
  const first = p.ownerName?.trim().split(/\s+/)[0]
  const link = templateLink(t, p.appUrl, i.locale)
  const hello = first ? k('hello_name', { name: first }) : k('hello')
  const middle = t === 'free' ? '' : k(`${t}.body`, { shop: p.shopName, sender: p.sender, link: link ?? '' })
  const body = [hello, middle, `${k('closing')}\n${p.sender}\n${k('team')}`].join('\n\n')
  return { subject: k(`${t}.subject`, { shop: p.shopName }), body, link, cta: t === 'free' ? null : k(`${t}.cta`) }
}

const linkify = (s: string) => s.replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" style="color:#073e8a;">${u}</a>`)

/** E-mail aux couleurs StockShop à partir du texte VALIDÉ : paragraphes, liens
 *  cliquables ; la ligne qui ne contient que le lien du tour devient un bouton. */
export function renderSupportEmail(i: EmailI18n, p: { body: string; link: string | null; cta: string | null; appUrl: string }): { html: string; text: string } {
  const blocks = p.body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const html = blocks.map(b => {
    if (p.link && p.cta && b === p.link) {
      return `<p style="margin:20px 0 16px;text-align:center;"><a href="${esc(p.link)}" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">${esc(p.cta)}</a></p>`
    }
    return `<p style="margin:12px 0 0;font-size:15px;color:#1f2937;line-height:1.6;">${linkify(esc(b)).replace(/\n/g, '<br/>')}</p>`
  }).join('') + '<div style="height:14px"></div>'
  const footer = esc(i.t('support_contact.footer'))
  return { html: emailShell({ appUrl: p.appUrl, body: html, footer, lang: i.locale }), text: p.body }
}

/** Lien WhatsApp (wa.me) avec le message déjà écrit ; null si le numéro est inutilisable */
export function whatsappUrl(phone: string | null, text: string): string | null {
  const digits = (phone || '').replace(/[^\d]/g, '')
  if (digits.length < 8) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
