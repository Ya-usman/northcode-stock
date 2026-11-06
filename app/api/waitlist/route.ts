import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { WAITLIST_LOCALES, isSubTradeOf, isWaitlistSector, normalizeContact } from '@/lib/site/waitlist'

// POST /api/waitlist (public, sans compte) — liste d'attente des métiers (lot C, migration 217).
// Corps : { sector, sub_trade?, contact, locale, website? }. « website » est un champ piège invisible : rempli, la
// réponse est la même mais rien n'est enregistré (aucune indication donnée aux robots).
// Une ligne par métier + contact : une nouvelle inscription du même contact met la ligne à jour (signups + 1).
// Pays du visiteur : en-tête de l'hébergeur (jamais saisi). Table réservée au serveur (aucun accès du navigateur).
export const dynamic = 'force-dynamic'

const bad = (code: string) => NextResponse.json({ ok: false, error: code }, { status: 400 })

export async function POST(request: Request) {
  let body: any
  try { body = await request.json() } catch { return bad('invalid_body') }
  if (!body || typeof body !== 'object') return bad('invalid_body')

  // Piège à robots : même réponse qu'un succès, rien n'est enregistré
  if (typeof body.website === 'string' && body.website.trim() !== '') return NextResponse.json({ ok: true })

  if (!isWaitlistSector(body.sector)) return bad('invalid_sector')
  const sector = body.sector
  const sub = body.sub_trade == null || body.sub_trade === '' ? null : body.sub_trade
  if (sub !== null && !isSubTradeOf(sector, sub)) return bad('invalid_sub_trade')
  const contact = normalizeContact(body.contact)
  if (!contact) return bad('invalid_contact')
  const locale = (WAITLIST_LOCALES as readonly string[]).includes(body.locale) ? body.locale : 'fr'
  const geo = (request.headers.get('x-vercel-ip-country') || '').toUpperCase()
  const country = /^[A-Z]{2}$/.test(geo) ? geo : null

  // Limite (5 par heure et par adresse) juste avant l'écriture : les envois refusés ci-dessus n'écrivent rien
  const limited = await checkRateLimit(request, 'waitlist')
  if (limited) return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429, headers: limited.headers })

  try {
    const admin = await createAdminClient() as any
    const row = { sector, sub_trade: sub, contact: contact.value, contact_kind: contact.kind, locale, country }
    const { error } = await admin.from('waitlist').insert(row)
    if (error) {
      if (error.code !== '23505') throw error
      // Déjà inscrit pour ce métier : la ligne est mise à jour (sous-métier, langue, pays), répétition comptée
      const { data: existing, error: e1 } = await admin.from('waitlist').select('id, signups').eq('sector', sector).eq('contact', contact.value).maybeSingle()
      if (e1 || !existing) throw e1 || new Error('waitlist row missing')
      const { error: e2 } = await admin.from('waitlist').update({
        signups: existing.signups + 1, updated_at: new Date().toISOString(), locale,
        ...(sub ? { sub_trade: sub } : {}), ...(country ? { country } : {}),
      }).eq('id', existing.id)
      if (e2) throw e2
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('waitlist', err?.message)
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}
