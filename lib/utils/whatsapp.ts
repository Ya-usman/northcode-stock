/**
 * Generate a WhatsApp deep link
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const number = phone.replace(/\D/g, '')
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

/**
 * Numéro au format international sans « + » attendu par wa.me : un numéro
 * local (« 06 78 90 12 34 », « 0612345678 ») reçoit l'indicatif du pays de la
 * boutique (phonePrefix, ex. « +237 ») ; un numéro déjà international est gardé.
 */
export function normalizeWhatsAppNumber(phone: string, phonePrefix: string): string {
  const digits = phone.replace(/\D/g, '')
  const prefix = phonePrefix.replace(/\D/g, '')
  if (!digits) return ''
  if (phone.trim().startsWith('+') || phone.trim().startsWith('00')) return digits.replace(/^00/, '')
  if (prefix && digits.startsWith(prefix) && digits.length > prefix.length + 6) return digits
  return prefix + digits.replace(/^0+/, '')
}

export interface ReceiptMessageLabels {
  receipt: string
  items: string
  paid: string
  balance: string
  fullyPaid: string
  debtRepayment: string
  totalCollected: string
  thankYou: string
  /** « Votre reçu en ligne », devant le lien public. */
  onlineReceipt: string
}

/**
 * Build a receipt message for WhatsApp sharing
 */
export function buildReceiptWhatsAppMessage(params: {
  shopName: string
  saleNumber: string
  date: string
  items: { name: string; qty: number; price: number }[]
  total: number
  paid: number
  balance: number
  /** Libellé lisible du moyen de paiement (« Espèces »), pas l'identifiant. */
  method: string
  customerName?: string
  currencySymbol?: string
  /** Remboursement de dette encaissé avec cette vente (hors vente). */
  debtRepayment?: number
  /** Lien public du reçu (stockshop.tech/r/…) : le client le garde, le PDF s'y télécharge. */
  receiptUrl?: string | null
  /** Libellés traduits ; anglais par défaut. */
  labels?: Partial<ReceiptMessageLabels>
}): string {
  const { shopName, saleNumber, date, items, total, paid, balance, method, customerName, currencySymbol = '₦', debtRepayment = 0, receiptUrl } = params
  const L: ReceiptMessageLabels = {
    receipt: 'Receipt', items: 'Items', paid: 'Paid', balance: 'Balance', fullyPaid: 'Fully paid',
    debtRepayment: 'Debt repayment', totalCollected: 'Total collected', thankYou: 'Thank you for your business',
    onlineReceipt: 'Your receipt online',
    ...params.labels,
  }

  const fmt = (n: number) => currencySymbol.length > 2
    ? `${n.toLocaleString()} ${currencySymbol}`
    : `${currencySymbol}${n.toLocaleString()}`

  const lines = [
    `🧾 *${shopName}*`,
    `${L.receipt} #${saleNumber}`,
    `📅 ${date}`,
    customerName ? `👤 ${customerName}` : '',
    ``,
    `*${L.items} :*`,
    ...items.map(i => `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)}`),
    ``,
    `━━━━━━━━━━`,
    `*TOTAL : ${fmt(total)}*`,
    `${L.paid} : ${fmt(paid)} (${method})`,
    balance > 0 ? `⚠️ ${L.balance} : ${fmt(balance)}` : `✅ ${L.fullyPaid}`,
    debtRepayment > 0 ? `${L.debtRepayment} : +${fmt(debtRepayment)}` : '',
    debtRepayment > 0 ? `*${L.totalCollected} : ${fmt(paid + debtRepayment)}*` : '',
    ``,
    receiptUrl ? `🔗 ${L.onlineReceipt} : ${receiptUrl}` : '',
    `_${L.thankYou}_`,
  ].filter(Boolean)

  return lines.join('\n')
}

/**
 * Open WhatsApp with pre-filled message.
 * Renvoie false si le navigateur a bloqué l'ouverture (ouverture automatique
 * hors clic sur ordinateur) : l'appelant propose alors un bouton.
 */
export function shareViaWhatsApp(phone: string, message: string): boolean {
  const url = buildWhatsAppLink(phone, message)
  return window.open(url, '_blank') !== null
}

/**
 * Share receipt via WhatsApp (no specific number — opens chat picker)
 */
export function shareReceiptWhatsApp(message: string): boolean {
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`
  return window.open(url, '_blank') !== null
}
