import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { FileQuestion, MessageCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { RECEIPT_TOKEN_RE } from '@/lib/receipt/receipt-link'
import { hideStockShopBranding } from '@/lib/receipt/branding'
import { textLines } from '@/lib/receipt/ticket'
import { getCountry, getPaymentMethodLabel } from '@/lib/saas/countries'
import { formatCurrency } from '@/lib/utils/currency'
import { BrandLogo } from '@/components/brand/brand-logo'
import { ShopLogo } from '@/components/shop/shop-logo'
import { DownloadReceiptButton } from './download-button'

// Page publique du reçu — stockshop.tech/r/<jeton> (QR du ticket, lien
// WhatsApp). Sans connexion : le jeton (migration 150) est indevinable, la
// page n'est pas indexée, il n'existe aucune liste. Hors des routes
// localisées : la langue vient du navigateur du client (fr / en / ha).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Reçu · StockShop',
  robots: { index: false, follow: false, nocache: true },
}

type Locale = 'fr' | 'en' | 'ha'

function detectLocale(): Locale {
  const accept = headers().get('accept-language') || ''
  for (const part of accept.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase()
    if (code === 'fr' || code === 'en' || code === 'ha') return code
  }
  return 'fr'
}

const DATE_LOCALE: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 dark:bg-slate-950 sm:py-10">
      <article className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10">
        {children}
      </article>
    </main>
  )
}

export default async function PublicReceiptPage({ params }: { params: { token: string } }) {
  const locale = detectLocale()
  const R = (await import(`../../../messages/${locale}.json`)).default.receipt as Record<string, string>
  const token = (params.token || '').trim()

  const notFound = (
    <Shell>
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <FileQuestion className="h-10 w-10 text-slate-400" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">{R.public_not_found_title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{R.public_not_found_text}</p>
        <a href="https://stockshop.tech" className="mt-2"><BrandLogo tone="auto" className="text-[18px]" /></a>
      </div>
    </Shell>
  )
  if (!RECEIPT_TOKEN_RE.test(token)) return notFound

  const admin = createAdminClient() as any
  const { data: sale } = await admin
    .from('sales')
    .select('*, sale_items(*), customers(name), shops(*)')
    .eq('receipt_token', token)
    .maybeSingle()
  // Une reprise de dette n'est pas une vente : pas de reçu public
  if (!sale || !sale.shops || sale.sale_status === 'opening') return notFound

  const shop = sale.shops
  const [{ data: cashier }, { data: payments }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', sale.cashier_id).maybeSingle(),
    admin.from('payments').select('amount, method').eq('sale_id', sale.id),
  ])

  const fmt = (n: number) => formatCurrency(Number(n) || 0, shop.currency)
  const country = getCountry(shop.country)
  const payLabel = (id: string) => id === 'mixed'
    ? R.method_mixed
    : (country.paymentMethods.find((m: { id: string }) => m.id === id)?.label ?? getPaymentMethodLabel(id) ?? id)
  const dateText = new Date(sale.created_at).toLocaleString(DATE_LOCALE[locale], {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const items: any[] = sale.sale_items || []
  const units = items.reduce((s, it) => s + (Number.isInteger(Number(it.quantity)) ? Number(it.quantity) : 1), 0)
  const itemCount = units === 1 ? R.item_count_one : R.item_count_other.replace('{count}', String(units))
  const legal = textLines(shop.receipt_legal_ids)
  const footer = textLines(shop.receipt_footer)
  const place = [shop.city, shop.state].filter(Boolean).join(', ')
  const cancelled = sale.sale_status === 'cancelled'
  const hideBranding = hideStockShopBranding(shop)
  const discount = Number(sale.discount) || 0
  const tax = Number(sale.tax) || 0
  const balance = Number(sale.balance) || 0
  const payRows: { amount: number; method: string }[] = Array.isArray(payments) && payments.length > 1 ? payments : []

  const pdfData = {
    sale, shop,
    cashierName: cashier?.full_name || '',
    customerName: sale.customers?.name || undefined,
    locale,
    hideBranding,
    labels: {
      receipt: R.receipt, cashier: R.cashier, customer: R.customer, colItem: R.col_item, colQty: R.col_qty,
      colUnitPrice: R.col_unit_price, colTotal: R.col_total, subtotal: R.subtotal, discount: R.discount, tax: R.tax,
      total: R.total, paid: R.paid, via: R.via, balanceDue: R.balance_due, thankYou: R.thank_you, promoWas: R.promo_was,
      debtRepayment: R.debt_repayment, totalCollected: R.total_collected, saleTitle: R.sale_title, date: R.date,
      paymentMethod: R.payment_method, methodMixed: R.method_mixed, paidStatus: R.paid_status, amountPaid: R.amount_paid,
      generatedBy: R.generated_by, onlineReceipt: R.online_receipt,
    },
  }

  const Row = ({ label, value, className = '' }: { label: string; value: string; className?: string }) => (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )

  return (
    <Shell>
      {/* En-tête : la marque du commerçant, pas la nôtre */}
      <header className="flex items-start gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
        <ShopLogo src={shop.logo_url} name={shop.name} size="md" shape="auto" />
        <div className="min-w-0 text-sm text-slate-500 dark:text-slate-400">
          <h1 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">{shop.name}</h1>
          {shop.receipt_tagline && <p className="italic">{shop.receipt_tagline}</p>}
          {place && <p>{place}</p>}
          {shop.whatsapp && <p>WhatsApp : {shop.whatsapp}</p>}
          {legal.map(line => <p key={line} className="text-xs text-slate-400 dark:text-slate-500">{line}</p>)}
        </div>
      </header>

      {cancelled && (
        <div className="bg-red-50 px-5 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{R.public_cancelled}</div>
      )}

      <section className="p-5 text-sm text-slate-700 dark:text-slate-200">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-stockshop-blue dark:text-blue-300">{R.sale_title}</h2>
          <span className="rounded-md bg-stockshop-blue-muted px-2 py-0.5 font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">#{sale.sale_number}</span>
        </div>
        <dl className="mt-3 space-y-1">
          <Row label={R.date} value={dateText} />
          {cashier?.full_name && <Row label={R.cashier} value={cashier.full_name} />}
          {sale.customers?.name && <Row label={R.customer} value={sale.customers.name} />}
          <Row label={R.payment_method} value={payLabel(sale.payment_method)} />
        </dl>

        <table className="mt-5 w-full">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="py-1.5 font-medium">{R.col_item}</th>
              <th className="py-1.5 text-center font-medium">{R.col_qty}</th>
              <th className="py-1.5 text-right font-medium">{R.col_total}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id ?? i} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-2">
                  <span className="text-slate-400">{i + 1}.</span> {it.product_name}
                  <div className="text-xs text-slate-500">{it.quantity} × {fmt(it.unit_price)}</div>
                </td>
                <td className="py-2 text-center tabular-nums">{it.quantity}</td>
                <td className="py-2 text-right font-medium tabular-nums">{fmt(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-right text-xs text-slate-500">{itemCount}</p>

        <div className="mt-4 space-y-1.5">
          {(discount > 0 || tax > 0) && <Row label={R.subtotal} value={fmt(sale.subtotal)} />}
          {discount > 0 && <Row label={R.discount} value={`-${fmt(discount)}`} />}
          {tax > 0 && <Row label={R.tax} value={fmt(tax)} />}
          <div className="flex items-center justify-between rounded-lg bg-stockshop-blue-muted px-3 py-2 text-base font-bold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">
            <span>{R.total}</span>
            <span className="tabular-nums">{fmt(sale.total)}</span>
          </div>
          {balance > 0 && <Row label={R.balance_due} value={fmt(balance)} className="font-semibold text-amber-700 dark:text-amber-400" />}
          <Row label={R.amount_paid} value={fmt(sale.amount_paid)} className={balance > 0 ? '' : 'font-semibold'} />
          {payRows.map((p, i) => <Row key={i} label={`· ${payLabel(p.method)}`} value={fmt(p.amount)} className="text-slate-500" />)}
        </div>

        <div className="mt-6 text-center">
          <p className="font-semibold text-slate-900 dark:text-white">{footer[0] ?? R.thank_you}</p>
          {(footer.length ? footer.slice(1) : [R.see_you_soon]).map(line => (
            <p key={line} className="text-slate-500 dark:text-slate-400">{line}</p>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <DownloadReceiptButton data={pdfData} label={R.public_download_pdf} className="flex-1" />
          {shop.whatsapp && (
            <a
              href={`https://wa.me/${String(shop.whatsapp).replace(/\D/g, '')}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <MessageCircle className="h-4 w-4" />
              {R.public_contact_shop}
            </a>
          )}
        </div>
      </section>

      {!hideBranding && (
        <footer className="flex flex-col items-center gap-1 border-t border-slate-200 py-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>{R.powered_by}</span>
          <a href="https://stockshop.tech" target="_blank" rel="noopener noreferrer"><BrandLogo tone="auto" className="text-[18px]" /></a>
        </footer>
      )}
    </Shell>
  )
}
