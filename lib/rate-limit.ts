import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Different limiters for different sensitivity levels
const limiters = {
  // Registration: max 5 attempts per hour per IP
  register: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'rl:register',
  }),
  // Billing/payments: max 10 per hour per IP
  billing: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'rl:billing',
  }),
  // General API: max 60 per minute per IP
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:api',
  }),
}

export type RateLimitKey = keyof typeof limiters

export async function checkRateLimit(
  request: Request,
  key: RateLimitKey = 'api',
): Promise<NextResponse | null> {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    const { success, limit, remaining, reset } = await limiters[key].limit(ip)

    if (!success) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Réessayez plus tard.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
            'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
          },
        },
      )
    }

    return null // No limit hit — proceed normally
  } catch {
    // If Redis is unreachable, fail open (don't block legitimate users)
    return null
  }
}
