/**
 * Generate a WhatsApp deep link
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const number = phone.replace(/\D/g, '')
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
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
  method: string
  customerName?: string
}): string {
  const { shopName, saleNumber, date, items, total, paid, balance, method, customerName } = params

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG')}`

  const lines = [
    `🧾 *${shopName}*`,
    `Receipt #${saleNumber}`,
    `📅 ${date}`,
    customerName ? `👤 ${customerName}` : '',
    ``,
    `*Items:*`,
    ...items.map(i => `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)}`),
    ``,
    `━━━━━━━━━━`,
    `*TOTAL: ${fmt(total)}*`,
    `Paid: ${fmt(paid)} (${method})`,
    balance > 0 ? `⚠️ Balance: ${fmt(balance)}` : `✅ Fully Paid`,
    ``,
    `_Thank you! Na gode da kasuwancin ku_`,
  ].filter(Boolean)

  return lines.join('\n')
}

/**
 * Open WhatsApp with pre-filled message
 */
export function shareViaWhatsApp(phone: string, message: string): void {
  const url = buildWhatsAppLink(phone, message)
  window.open(url, '_blank')
}

/**
 * Share receipt via WhatsApp (no specific number — opens chat picker)
 */
export function shareReceiptWhatsApp(message: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`
  window.open(url, '_blank')
}
