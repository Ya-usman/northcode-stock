// Lancement d'un paiement auprès de la passerelle du pays (Paystack, NotchPay, Wave, Flutterwave), à partir d'un
// paiement déjà PRÉPARÉ par le serveur (lib/billing/payment-intents, migration 204). Commun à l'abonnement
// (/api/billing/subscribe) et aux options (/api/billing/addons). Sorti tel quel de /api/billing/subscribe le 3 nov. 2026.
import { NextResponse } from 'next/server'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { failPaymentIntent, setGatewayReference } from '@/lib/billing/payment-intents'
// Map our internal payment method IDs to Paystack channels.
// 'mobile_money' n'est PAS un canal Paystack valide pour le Nigeria (NGN) — ce
// canal n'existe que pour le Ghana/Kenya/Afrique du Sud sur Paystack. OPay et
// PalmPay sont des néobanques nigérianes qui reçoivent par virement vers un
// compte virtuel dédié, exactement comme Moniepoint — donc bank_transfer ici,
// pas mobile_money (qui faisait échouer tout l'appel transaction/initialize).
function toPaystackChannels(methodId: string): string[] {
  const map: Record<string, string[]> = {
    transfer:   ['bank_transfer'],
    pos:        ['card'],
    opay:       ['bank_transfer'],
    palmpay:    ['bank_transfer'],
    moniepoint: ['bank_transfer'],
    ussd:       ['ussd'],
  }
  return map[methodId] ?? ['card', 'bank_transfer', 'ussd']
}

// Map our internal method IDs to Flutterwave payment_options per country
function toFlutterwaveOption(methodId: string, countryCode: string): string {
  const mobileMoneyByCountry: Record<string, string> = {
    CM: 'mobilemoneycameroon',
    CI: 'mobilemoneycotedivoire',
    ML: 'mobilemoneymali',
    NE: 'mobilemoneyniger',
    SN: 'mobilemoneysenegal',
    BJ: 'mobilemoneybenin',
    GH: 'mobilemoneyghana',
    TG: 'account', // Togo: Flooz/T-Money via account
  }
  if (['wave', 'orange_money', 'mtn_momo', 'moov_money', 'free_money',
       'amana', 'nita', 'airtel_money', 'flooz', 'tmoney'].includes(methodId)) {
    return mobileMoneyByCountry[countryCode] ?? 'mobilemoney'
  }
  if (methodId === 'transfer') return 'banktransfer'
  if (methodId === 'pos') return 'card'
  return 'mobilemoney,card,banktransfer'
}

export interface StartPaymentOptions {
  supabase: any
  t: (key: any, params?: any) => string
  /** Passerelle du pays (country.gateway) ; Wave est choisi par le moyen de paiement */
  gatewayOf: string
  countryCode: string
  paymentMethod: string
  reference: string
  amountDue: number
  currency: string
  email: string
  locale: string | undefined
  baseUrl: string
  /** Informations jointes au paiement (affichage chez la passerelle ; jamais relues pour activer) */
  meta: Record<string, unknown>
  descriptions: { notchpay: string; flutterwave: string }
}

export async function startGatewayPayment(o: StartPaymentOptions): Promise<NextResponse> {
  const { supabase, t, gatewayOf, countryCode, paymentMethod, reference, amountDue, currency, email, locale, baseUrl, meta, descriptions } = o
  const gatewayFailed = async (why: string) => { await failPaymentIntent(supabase, reference, why) }

  // ── Nigeria → Paystack ──────────────────────────────────────────────────
  if (gatewayOf === 'paystack') {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) { await gatewayFailed('paystack_not_configured'); return NextResponse.json({ error: t('paystack_not_configured') }, { status: 500 }) }

    const channels = toPaystackChannels(paymentMethod ?? '')

    const res = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        reference,
        currency: currency,
        amount: Math.round(amountDue * 100),
        callback_url: `${baseUrl}/api/billing/verify?locale=${locale}`,
        metadata: { ...meta, gateway: 'paystack' },
        channels,
      }),
    })
    const data = await res.json()
    if (!data.status) { await gatewayFailed(String(data.message || 'paystack_init')); return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 }) }

    return NextResponse.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      public_key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
      amount_kobo: Math.round(amountDue * 100),
      channels,
    })
  }

  // ── NotchPay (Cameroun — Orange Money & MTN MoMo XAF natif) ───────────
  if (gatewayOf === 'notchpay') {
    const publicKey = process.env.NOTCHPAY_PUBLIC_KEY
    if (!publicKey) { await gatewayFailed('notchpay_not_configured'); return NextResponse.json({ error: t('notchpay_not_configured') }, { status: 500 }) }

    const res = await fetchWithTimeout('https://api.notchpay.co/payments/initialize', {
      method: 'POST',
      headers: {
        Authorization: publicKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountDue,
        currency: currency,
        reference,
        callback: `${baseUrl}/api/billing/notchpay/verify?locale=${locale}`,
        description: descriptions.notchpay,
        meta,
      }),
    })
    const data = await res.json()
    const url = data.authorization_url
    if (!url) { await gatewayFailed(String(data.message || 'notchpay_init')); return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 }) }
    await setGatewayReference(supabase, reference, data.transaction?.reference)
    return NextResponse.json({ authorization_url: url, reference: data.transaction?.reference || '' })
  }

  // ── Wave (pays FCFA avec Wave sélectionné) ────────────────────────────
  if (gatewayOf === 'flutterwave' && paymentMethod === 'wave') {
    const waveKey = process.env.WAVE_API_KEY
    if (!waveKey) { await gatewayFailed('wave_not_configured'); return NextResponse.json({ error: t('wave_not_configured') }, { status: 500 }) }

    const res = await fetchWithTimeout('https://api.wave.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${waveKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: String(amountDue),
        currency: currency,
        success_url: `${baseUrl}/api/billing/wave/verify?locale=${locale}`,
        error_url: `${baseUrl}/${locale}/billing?error=payment_failed`,
        // Notre référence seule : la formule, la durée et le montant sont dans la préparation (migration 204)
        client_reference: reference,
      }),
    })
    const data = await res.json()
    const url = data.wave_launch_url
    if (!url) { await gatewayFailed(String(data.message || 'wave_init')); return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 }) }
    await setGatewayReference(supabase, reference, data.id)
    return NextResponse.json({ authorization_url: url, reference })
  }

  // ── Flutterwave (tous les autres pays FCFA) ────────────────────────────
  if (gatewayOf === 'flutterwave') {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
    if (!secretKey) { await gatewayFailed('flutterwave_not_configured'); return NextResponse.json({ error: t('flutterwave_not_configured') }, { status: 500 }) }

    const tx_ref = reference
    const payment_options = toFlutterwaveOption(paymentMethod ?? '', countryCode)

    const res = await fetchWithTimeout('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref,
        amount: amountDue,
        currency: currency,
        redirect_url: `${baseUrl}/api/billing/flutterwave/verify?locale=${locale}`,
        customer: { email },
        meta,
        customizations: {
          title: 'StockShop',
          description: descriptions.flutterwave,
          logo: `${baseUrl}/icons/icon-192x192.png`,
        },
        payment_options,
      }),
    })
    const data = await res.json()
    const url = data.data?.link
    if (!url) { await gatewayFailed(String(data.message || 'flutterwave_init')); return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 }) }

    return NextResponse.json({ authorization_url: url, reference: tx_ref })
  }

  if (gatewayOf === 'stripe') {
    // Pas encore implémenté. Quand ce sera fait : envoyer `currency`
    // (EUR pour les 27 pays UE) à Stripe — JAMAIS country.currency, qui
    // pour 6 pays UE (CZ/DK/HU/PL/RO/SE) est la devise boutique locale,
    // pas la devise de facturation StockShop.
    return NextResponse.json({ error: 'stripe_coming_soon' }, { status: 400 })
  }

  return NextResponse.json({ error: t('unknown_gateway') }, { status: 500 })
}
