// Message d'un bon de commande (objet + texte), UNE seule source pour la fenêtre « Envoyer » (copie, WhatsApp) et
// pour l'e-mail envoyé par le serveur (31 oct. 2026). Textes : messages « emails.purchase_order », dans la langue
// de l'application au moment de l'envoi.

/** Traduction d'une clé de « emails.purchase_order » (ex. « subject ») */
export type PoMessageTranslator = (key: string, values?: Record<string, string | number>) => string

export interface PoMessageInput {
  reference: string
  shopName: string
  supplierName: string
  /** Date du bon, déjà mise en forme dans la langue */
  dateStr: string
  /** Lignes déjà mises en forme : « Ampoule 60 W » + « 20 pièces » */
  lines: { name: string; quantity: string }[]
  /** Référence du bon d'origine pour un « Commander le reste » (notes « [reorder:BC-…] ») */
  reorderOf?: string | null
}

export interface PoMessage {
  subject: string
  greeting: string
  intro: string
  productsTitle: string
  confirm: string
  regards: string
  /** Texte complet, prêt à copier ou à envoyer par WhatsApp */
  body: string
}

/** Bon créé via « Commander le reste » : référence du bon d'origine, gardée en tête des notes */
export function reorderOriginalRef(notes: string | null | undefined): string | null {
  return notes?.match(/^\[reorder:(.+?)\]/)?.[1] ?? null
}

export function buildPoMessage(tr: PoMessageTranslator, p: PoMessageInput): PoMessage {
  const values = { reference: p.reference, shop: p.shopName, supplier: p.supplierName, date: p.dateStr, original: p.reorderOf || '' }
  const subject = tr(p.reorderOf ? 'subject_reorder' : 'subject', values)
  const greeting = tr('greeting', values)
  const intro = tr(p.reorderOf ? 'intro_reorder' : 'intro', values)
  const productsTitle = tr('products')
  const confirm = tr('confirm')
  const regards = tr('regards')
  const body = [
    greeting,
    '',
    intro,
    '',
    productsTitle,
    ...p.lines.map(l => tr('line', { name: l.name, quantity: l.quantity }).trim()),
    '',
    confirm,
    '',
    regards,
    p.shopName,
  ].join('\n')
  return { subject, greeting, intro, productsTitle, confirm, regards, body }
}

/** Intitulés du PDF du bon dans la langue (clés « emails.purchase_order.pdf.* ») */
export function poPdfLabels(tr: PoMessageTranslator) {
  return {
    title: tr('pdf.title'),
    reference: tr('pdf.reference'),
    date: tr('pdf.date'),
    supplier: tr('pdf.supplier'),
    colProduct: tr('pdf.col_product'),
    colQty: tr('pdf.col_qty'),
    colUnitPrice: tr('pdf.col_unit_price'),
    colTotal: tr('pdf.col_total'),
    total: tr('pdf.total'),
    generatedBy: tr('pdf.generated_by'),
    page: tr('pdf.page'),
    of: tr('pdf.of'),
  }
}
