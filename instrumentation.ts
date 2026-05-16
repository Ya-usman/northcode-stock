// Called once on server startup (Next.js instrumentation hook).
// Fails fast if critical env vars are missing rather than surfacing
// cryptic runtime errors deep inside request handlers.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const REQUIRED: string[] = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SITE_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ]

  // At least one payment gateway must be configured
  const PAYMENT_GATEWAYS = [
    'PAYSTACK_SECRET_KEY',
    'FLUTTERWAVE_SECRET_KEY',
    'NOTCHPAY_PUBLIC_KEY',
  ]

  const missing = REQUIRED.filter(key => !process.env[key])

  if (missing.length > 0) {
    throw new Error(
      `[startup] Missing required environment variables:\n  ${missing.join('\n  ')}`
    )
  }

  const hasGateway = PAYMENT_GATEWAYS.some(key => !!process.env[key])
  if (!hasGateway && process.env.NODE_ENV === 'production') {
    throw new Error(
      `[startup] No payment gateway configured. Set at least one of:\n  ${PAYMENT_GATEWAYS.join('\n  ')}`
    )
  }
}
