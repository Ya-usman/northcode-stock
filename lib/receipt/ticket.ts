// Modèle de ticket de caisse (rouleau thermique 58 / 80 mm).
//
// Une seule source de vérité : `buildSaleTicket` produit une liste de lignes
// abstraites (texte, deux colonnes, tableau, séparateur), que chaque sortie
// rend à sa façon — PDF à la largeur du rouleau aujourd'hui (impression
// système), octets ESC/POS pour le Bluetooth / réseau ensuite. Aucune
// dépendance React ni navigateur : testable en Node.

export type TicketWidth = 58 | 80
export type TicketAlign = 'left' | 'center' | 'right'
export type TicketSize = 'sm' | 'md' | 'lg' | 'xl'

export type TicketLine =
  | { kind: 'text'; text: string; align?: TicketAlign; bold?: boolean; size?: TicketSize }
  /** Libellé à gauche, valeur à droite (justifiés aux deux bords). */
  | { kind: 'row'; left: string; right: string; bold?: boolean; size?: TicketSize }
  /** Tableau : largeurs en fractions de la largeur imprimable. */
  | { kind: 'cols'; cells: string[]; widths: number[]; aligns: TicketAlign[]; bold?: boolean; size?: TicketSize }
  | { kind: 'rule' }
  | { kind: 'space'; h?: number }
  /** Image centrée (logo), déjà en noir et blanc, dimensions en points (8/mm). */
  | { kind: 'image'; logo: TicketLogo }

/** Logo prêt à imprimer (voir ticket-logo.ts) : PNG pour le PDF, source canvas pour l'ESC/POS. */
export interface TicketLogo {
  dataUrl: string
  /** Largeur et hauteur en points (multiples de 8). */
  width: number
  height: number
  /** Canvas (navigateur) ou données d'image — passé tel quel à l'encodeur ESC/POS. */
  source?: unknown
}

export interface TicketLabels {
  title: string
  date: string
  cashier: string
  customer: string
  colItem: string
  colQty: string
  colUnitPrice: string
  /** Version courte pour la colonne étroite du ticket (« P.U. »). */
  colUnitShort: string
  colTotal: string
  subtotal: string
  discount: string
  tax: string
  total: string
  /** « Montant payé » : libellé de la ligne, pas le statut. */
  amountPaid: string
  received: string
  change: string
  balanceDue: string
  debtRepayment: string
  totalCollected: string
  thankYou: string
  /** Seconde ligne du pied (« À très bientôt ! »), absente si la boutique a son propre message. */
  seeYouSoon: string
  generatedBy: string
  /** « Propulsé par », au-dessus de la signature StockShop. */
  poweredBy: string
  /** « Scannez pour retrouver votre reçu », sous le QR. */
  scanHint: string
  /** « 3 articles » sous la liste. */
  itemCount: (n: number) => string
}

/** Libellés depuis next-intl (`t` de useTranslations()). */
export function ticketLabelsFromT(t: (key: string, values?: Record<string, string | number>) => string): TicketLabels {
  return {
    title: t('receipt.sale_title'),
    date: t('receipt.date'),
    cashier: t('receipt.cashier'),
    customer: t('receipt.customer'),
    colItem: t('receipt.col_item'),
    colQty: t('receipt.col_qty'),
    colUnitPrice: t('receipt.col_unit_price'),
    colUnitShort: t('receipt.col_unit_short'),
    colTotal: t('receipt.col_total'),
    subtotal: t('receipt.subtotal'),
    discount: t('receipt.discount'),
    tax: t('receipt.tax'),
    total: t('receipt.total'),
    amountPaid: t('receipt.amount_paid'),
    received: t('receipt.received'),
    change: t('receipt.change'),
    balanceDue: t('receipt.balance_due'),
    debtRepayment: t('receipt.debt_repayment'),
    totalCollected: t('receipt.total_collected'),
    thankYou: t('receipt.thank_you'),
    seeYouSoon: t('receipt.see_you_soon'),
    generatedBy: t('receipt.generated_by'),
    poweredBy: t('receipt.powered_by'),
    scanHint: t('receipt.scan_hint'),
    // Pas de pluriel ICU dans les messages du projet : deux clés
    itemCount: (n) => (n === 1 ? t('receipt.item_count_one') : t('receipt.item_count_other', { count: n })),
  }
}

export interface TicketItem {
  name: string
  qty: number
  unitPrice: number
  subtotal: number
}

export interface TicketData {
  /** Identité de la boutique ; `tagline` (activité) et `legalIds` (mentions légales, une par ligne) viennent des réglages (migration 149). */
  shop: { name: string; city?: string | null; state?: string | null; whatsapp?: string | null; tagline?: string | null; legalIds?: string | null }
  saleNumber: string
  createdAt: string | Date
  items: TicketItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  amountPaid: number
  balance: number
  /** Libellé lisible du moyen de paiement, déjà résolu par l'appelant (« Espèces », « MTN MoMo », « Paiement mixte »). */
  paymentLabel: string
  /** Détail par moyen (paiement mixte) ; une seule entrée = pas de détail. */
  payments?: { label: string; amount: number }[]
  /** Espèces remises par le client et monnaie rendue (vente en espèces). */
  cashReceived?: number
  change?: number
  cashierName?: string
  customerName?: string
  /** Remboursement de dette encaissé en même temps que la vente (hors vente). */
  debtRepayment?: number
  locale?: string
  /** Montant avec devise (totaux, paiement). */
  fmt: (n: number) => string
  /** Montant sans devise pour les colonnes étroites des articles ; défaut : fmt. */
  fmtShort?: (n: number) => string
  labels: TicketLabels
  /** Message de pied de la boutique (shops.receipt_footer), lignes séparées par « \n » ; remplace le remerciement par défaut. */
  footerMessage?: string | null
  /** Logo de la boutique en tête du ticket (option par appareil). */
  logo?: TicketLogo | null
  /** Retire la signature et la mention StockShop (plans Pro / Business actifs). */
  hideBranding?: boolean
  /** Petite marque StockShop au pied du ticket, avec la mention (absente si hideBranding). */
  brandMark?: TicketLogo | null
  /** Lien public du reçu (receiptUrl(sale.receipt_token)) → QR préparé par print-ticket. */
  receiptUrl?: string | null
  qr?: TicketLogo | null
}

/** Texte multiligne saisi par la boutique → lignes non vides, sans espaces parasites. */
export function textLines(s?: string | null): string[] {
  return (s ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

export function buildSaleTicket(d: TicketData, width: TicketWidth): TicketLine[] {
  const L = d.labels
  const out: TicketLine[] = []
  const push = (l: TicketLine) => out.push(l)

  // ─── Boutique (la marque du commerçant, pas la nôtre) ───
  if (d.logo) {
    push({ kind: 'image', logo: d.logo })
    push({ kind: 'space', h: 1.5 })
  }
  push({ kind: 'text', text: d.shop.name, align: 'center', bold: true, size: 'xl' })
  if (d.shop.tagline) push({ kind: 'text', text: d.shop.tagline, align: 'center', size: 'sm' })
  const place = [d.shop.city, d.shop.state].filter(Boolean).join(', ')
  if (place) push({ kind: 'text', text: place, align: 'center', size: 'sm' })
  if (d.shop.whatsapp) push({ kind: 'text', text: `WhatsApp : ${d.shop.whatsapp}`, align: 'center', size: 'sm' })
  // Mentions légales (NIU, RCCM…) telles que saisies, une par ligne
  for (const line of textLines(d.shop.legalIds)) push({ kind: 'text', text: line, align: 'center', size: 'sm' })
  push({ kind: 'rule' })

  // ─── Titre + numéro ───
  push({ kind: 'text', text: L.title, align: 'center', bold: true, size: 'lg' })
  push({ kind: 'text', text: `#${d.saleNumber}`, align: 'center', bold: true, size: 'md' })
  push({ kind: 'rule' })

  // ─── Infos ───
  const date = new Date(d.createdAt).toLocaleString(d.locale || 'fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  push({ kind: 'row', left: `${L.date} :`, right: date, size: 'sm' })
  if (d.cashierName) push({ kind: 'row', left: `${L.cashier} :`, right: d.cashierName, size: 'sm' })
  if (d.customerName) push({ kind: 'row', left: `${L.customer} :`, right: d.customerName, size: 'sm' })
  push({ kind: 'rule' })

  // ─── Articles : tableau sur 80 mm, deux lignes par article sur 58 mm.
  // Colonnes en chiffres seuls (la devise est sur les totaux) : « 1 250 000 »
  // tient là où « 1 250 000 F CFA » déborderait.
  const short = d.fmtShort ?? d.fmt
  // Chaque article est numéroté : le client retrouve sa ligne et compte son sac.
  if (width === 80) {
    const widths = [0.06, 0.40, 0.12, 0.21, 0.21]
    const aligns: TicketAlign[] = ['left', 'left', 'center', 'right', 'right']
    push({ kind: 'cols', cells: ['#', L.colItem, L.colQty, L.colUnitShort, L.colTotal], widths, aligns, bold: true, size: 'sm' })
    push({ kind: 'rule' })
    d.items.forEach((it, i) => {
      push({ kind: 'cols', cells: [String(i + 1), it.name, String(it.qty), short(it.unitPrice), short(it.subtotal)], widths, aligns, size: 'sm' })
    })
  } else {
    d.items.forEach((it, i) => {
      push({ kind: 'text', text: `${i + 1}. ${it.name}`, size: 'md' })
      push({ kind: 'row', left: `  ${it.qty} × ${short(it.unitPrice)}`, right: d.fmt(it.subtotal), size: 'sm' })
    })
  }
  // Nombre d'unités ; une quantité décimale (1,5 kg) compte pour un article
  const units = d.items.reduce((s, it) => s + (Number.isInteger(it.qty) ? it.qty : 1), 0)
  push({ kind: 'text', text: L.itemCount(units), align: 'right', size: 'sm' })
  push({ kind: 'rule' })

  // ─── Totaux (lignes à zéro jamais imprimées) ───
  if (d.discount > 0 || d.tax > 0) push({ kind: 'row', left: L.subtotal, right: d.fmt(d.subtotal), size: 'sm' })
  if (d.discount > 0) push({ kind: 'row', left: L.discount, right: `-${d.fmt(d.discount)}`, size: 'sm' })
  if (d.tax > 0) push({ kind: 'row', left: L.tax, right: d.fmt(d.tax), size: 'sm' })
  push({ kind: 'row', left: L.total, right: d.fmt(d.total), bold: true, size: 'xl' })
  push({ kind: 'rule' })

  // ─── Paiement : un seul bloc, jamais répété ───
  if (d.balance <= 0) {
    push({ kind: 'row', left: L.amountPaid, right: d.fmt(d.amountPaid), bold: true, size: 'lg' })
  } else {
    push({ kind: 'row', left: L.balanceDue, right: d.fmt(d.balance), bold: true, size: 'lg' })
    push({ kind: 'row', left: L.amountPaid, right: d.fmt(d.amountPaid), size: 'sm' })
  }
  if (d.payments && d.payments.length > 1) {
    for (const p of d.payments) push({ kind: 'row', left: `  ${p.label}`, right: d.fmt(p.amount), size: 'sm' })
  } else {
    push({ kind: 'text', text: d.paymentLabel, size: 'sm' })
  }
  if ((d.change ?? 0) > 0 && (d.cashReceived ?? 0) > 0) {
    // Deux lignes : « Reçu : … Rendu : … » sur une seule débordait en 58 mm avec de gros montants
    push({ kind: 'row', left: L.received, right: d.fmt(d.cashReceived!), size: 'sm' })
    push({ kind: 'row', left: L.change, right: d.fmt(d.change!), size: 'sm' })
  }
  if ((d.debtRepayment ?? 0) > 0) {
    push({ kind: 'space', h: 1.5 })
    push({ kind: 'row', left: L.debtRepayment, right: `+${d.fmt(d.debtRepayment!)}`, size: 'sm' })
    push({ kind: 'row', left: L.totalCollected, right: d.fmt(d.amountPaid + d.debtRepayment!), bold: true, size: 'md' })
  }
  push({ kind: 'rule' })

  // ─── Pied ───
  const footer = textLines(d.footerMessage)
  if (footer.length) {
    // Message de la boutique : première ligne en gras, les suivantes en petit —
    // le commerçant qui écrit son propre message garde la main sur tout le pied
    footer.forEach((line, i) => push({ kind: 'text', text: line, align: 'center', bold: i === 0, size: i === 0 ? 'md' : 'sm' }))
  } else {
    push({ kind: 'text', text: L.thankYou, align: 'center', bold: true, size: 'md' })
    push({ kind: 'text', text: L.seeYouSoon, align: 'center', size: 'sm' })
  }
  // QR du reçu en ligne : service rendu au client, imprimé quel que soit le plan
  if (d.qr) {
    push({ kind: 'space', h: 1 })
    push({ kind: 'image', logo: d.qr })
    push({ kind: 'text', text: L.scanHint, align: 'center', size: 'sm' })
  }
  if (!d.hideBranding) {
    push({ kind: 'space', h: 1.5 })
    // En bas : le haut du ticket appartient à la boutique. « Propulsé par »,
    // signature (nom et slogan dans l'image), adresse du site ; le texte complet
    // ne sert que si l'image est indisponible.
    if (d.brandMark) {
      push({ kind: 'text', text: L.poweredBy, align: 'center', size: 'sm' })
      push({ kind: 'image', logo: d.brandMark })
      push({ kind: 'text', text: 'stockshop.tech', align: 'center', size: 'sm' })
    } else {
      push({ kind: 'text', text: L.generatedBy, align: 'center', size: 'sm' })
    }
  }
  return out
}
