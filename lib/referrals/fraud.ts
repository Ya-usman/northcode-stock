// Évaluation du risque de fraude au parrainage (points 25-28 de la demande).
//
// PRINCIPE : aucune décision ne repose sur un seul signal, et JAMAIS sur la
// seule adresse IP. Chaque signal a un poids ; au-delà d'un seuil cumulé,
// l'association est retenue pour revue manuelle (`needs_review = true`) — la
// récompense est créée mais ne mûrit pas tant qu'un super_admin n'a pas
// tranché (migration 134, RPC review_referral).
//
// Tout est calculé côté serveur à partir de données de confiance (audit
// logs, profils, table referrals) — rien qui vienne du frontend.

export interface FraudSignal {
  code: 'same_ip' | 'same_phone' | 'similar_email' | 'referrer_too_new' | 'velocity' | 'disposable_email'
  detail?: string
}

const SIGNAL_WEIGHT: Record<FraudSignal['code'], number> = {
  same_ip: 1, // seul, ne déclenche jamais une revue (seuil = 3)
  same_phone: 2,
  similar_email: 2,
  referrer_too_new: 1,
  velocity: 3, // suffisant à lui seul
  disposable_email: 2,
}

const REVIEW_THRESHOLD = 3

// Domaines d'emails jetables les plus courants — liste volontairement courte
// (les cas réels sont rares et la revue manuelle rattrape le reste).
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'temp-mail.org',
  'throwawaymail.com', 'maildrop.cc', 'mailnesia.com', 'dispostable.com', 'tempmail.com',
  'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'mintemail.com',
])

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '')
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[m]
}

/** Normalise un email : minuscule, retire les points + le "+tag" du local part. */
function normalizeEmail(email: string): { local: string; domain: string; raw: string } {
  const lower = (email || '').trim().toLowerCase()
  const at = lower.lastIndexOf('@')
  if (at < 0) return { local: lower, domain: '', raw: lower }
  const rawLocal = lower.slice(0, at)
  const domain = lower.slice(at + 1)
  const local = rawLocal.split('+')[0].replace(/\./g, '')
  return { local, domain, raw: rawLocal }
}

export async function assessReferralRisk(
  admin: any,
  params: {
    referrerUserId: string
    referredUserId: string
    referredEmail: string
    referredPhone: string | null
    referredIp: string
    maxPerDay: number
  },
): Promise<{ needsReview: boolean; flags: FraudSignal[] }> {
  const flags: FraudSignal[] = []

  try {
    const [{ data: referrerProfile }, { data: referrerReg }, { data: referrerAuth }, { data: recent }] =
      await Promise.all([
        admin.from('profiles').select('phone, created_at').eq('id', params.referrerUserId).maybeSingle(),
        admin.from('audit_logs').select('ip')
          .eq('actor_id', params.referrerUserId).eq('action', 'account.register')
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        admin.auth.admin.getUserById(params.referrerUserId),
        admin.from('referrals').select('id')
          .eq('referrer_user_id', params.referrerUserId)
          .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      ])

    // 1. Même IP d'inscription (1 signal parmi d'autres — jamais suffisant seul)
    const referrerIp = referrerReg?.ip
    if (referrerIp && referrerIp !== 'unknown' && referrerIp === params.referredIp) {
      flags.push({ code: 'same_ip', detail: params.referredIp })
    }

    // 2. Numéro de téléphone identique (9 derniers chiffres)
    const rp = digitsOnly(referrerProfile?.phone || '')
    const dp = digitsOnly(params.referredPhone || '')
    if (rp.length >= 9 && dp.length >= 9 && rp.slice(-9) === dp.slice(-9)) {
      flags.push({ code: 'same_phone' })
    }

    // 3. Email très proche de celui du parrain
    const referrerEmail = referrerAuth?.user?.email || ''
    if (referrerEmail) {
      const r = normalizeEmail(referrerEmail)
      const d = normalizeEmail(params.referredEmail)
      if (r.domain && r.domain === d.domain && (r.local === d.local || levenshtein(r.local, d.local) <= 1)) {
        flags.push({ code: 'similar_email', detail: `${d.raw}@${d.domain}` })
      }
    }

    // 4. Compte parrain très récent (< 3 jours) — typique du ring farming
    const createdAt = referrerProfile?.created_at || referrerAuth?.user?.created_at
    if (createdAt && Date.now() - new Date(createdAt).getTime() < 3 * 24 * 3600 * 1000) {
      flags.push({ code: 'referrer_too_new' })
    }

    // 5. Vélocité — trop de filleuls sur 24h
    const count24h = (recent || []).length
    if (count24h >= params.maxPerDay) {
      flags.push({ code: 'velocity', detail: `${count24h}/24h` })
    }

    // 6. Domaine email jetable
    const d = normalizeEmail(params.referredEmail)
    if (d.domain && DISPOSABLE_DOMAINS.has(d.domain)) {
      flags.push({ code: 'disposable_email', detail: d.domain })
    }
  } catch (err: any) {
    console.error('[assessReferralRisk]', err?.message)
    // En cas d'erreur d'analyse, on ne bloque pas : association normale.
    return { needsReview: false, flags: [] }
  }

  const score = flags.reduce((s, f) => s + SIGNAL_WEIGHT[f.code], 0)
  return { needsReview: score >= REVIEW_THRESHOLD, flags }
}
