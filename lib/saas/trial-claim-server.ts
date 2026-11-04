// Protection de l'essai — écritures SERVEUR (client admin). Règle : lib/saas/trial-claim ; registre trial_claims
// (migration 213). Empreintes HMAC-SHA256 : clé TRIAL_HASH_SECRET, sinon CRON_SECRET. La recherche essaie TOUTES les
// clés disponibles : le passage de CRON_SECRET à TRIAL_HASH_SECRET ne fait pas oublier les numéros déjà enregistrés.

import { createHmac } from 'crypto'
import { CLAIM_WINDOW_DAYS, decideTrial, nameCityKey, trialEnd, type PriorClaim, type TrialFlag } from './trial-claim'

const DAY = 86_400_000

function keys(): string[] {
  return Array.from(new Set([process.env.TRIAL_HASH_SECRET, process.env.CRON_SECRET].filter((k): k is string => !!k && k.length >= 16)))
}
/** Empreintes d'une valeur, une par clé disponible (la première sert à l'enregistrement) */
export function hashesOf(value: string | null | undefined): string[] {
  if (!value) return []
  return keys().map(k => createHmac('sha256', k).update(value).digest('hex'))
}

/**
 * État de l'essai sur l'entreprise. Colonne trial_status absente (avant la 213) : écrit sans elle, et une attente du
 * téléphone devient un essai normal (sans l'écran du numéro, le compte resterait bloqué).
 */
export async function setTrialState(admin: any, entityId: string, fields: { trial_ends_at: string | null; trial_status: 'granted' | 'refused' | 'pending_phone' }): Promise<void> {
  const base = { plan: 'trial', plan_expires_at: null, trial_ends_at: fields.trial_ends_at, updated_at: new Date().toISOString() }
  const { error } = await admin.from('entities').update({ ...base, trial_status: fields.trial_status }).eq('id', entityId)
  if (error) await admin.from('entities').update({ ...base, trial_ends_at: fields.trial_status === 'pending_phone' ? trialEnd() : fields.trial_ends_at }).eq('id', entityId)
}

async function priorClaims(admin: any, column: 'phone_hash' | 'device_hash' | 'name_hash', hashes: string[], now: Date): Promise<PriorClaim[]> {
  if (!hashes.length) return []
  const { data, error } = await admin.from('trial_claims').select('entity_id, granted, created_at').in(column, hashes)
    .gte('created_at', new Date(now.getTime() - CLAIM_WINDOW_DAYS * DAY).toISOString()).limit(50)
  if (error) throw new Error(`trial_claims: ${error.message}`)
  return data || []
}

export interface TrialClaimInput {
  entityId: string
  ownerId: string
  phone: string            // E.164 déjà contrôlé (normalizePhone)
  deviceId: string | null
  name: string | null
  city: string | null
  country: string | null
  source: 'register' | 'oauth'
}

/**
 * Décide et enregistre l'essai d'une NOUVELLE entreprise : accordé (30 jours) ou refusé (numéro déjà utilisé il y a
 * moins de 12 mois). Le registre ne peut pas être lu (213 absente, aucune clé) : l'essai est accordé comme avant,
 * jamais d'inscription bloquée par une panne.
 */
export async function claimTrial(admin: any, input: TrialClaimInput, now = new Date()): Promise<{ granted: boolean; flags: TrialFlag[]; previousAt: string | null; registered: boolean }> {
  const phoneH = hashesOf(input.phone), deviceH = hashesOf(input.deviceId), nameH = hashesOf(nameCityKey(input.name, input.city))
  let decision: ReturnType<typeof decideTrial> = { granted: true, flags: [], previousAt: null }
  let registered = false
  if (phoneH.length) {
    try {
      const [phone, device, nameCity] = await Promise.all([
        priorClaims(admin, 'phone_hash', phoneH, now), priorClaims(admin, 'device_hash', deviceH, now), priorClaims(admin, 'name_hash', nameH, now),
      ])
      decision = decideTrial({ phone, device, nameCity }, input.entityId, now)
      const { error } = await admin.from('trial_claims').insert({
        entity_id: input.entityId, owner_user_id: input.ownerId, phone_hash: phoneH[0], device_hash: deviceH[0] ?? null,
        name_hash: nameH[0] ?? null, country: input.country, source: input.source, granted: decision.granted, flags: decision.flags,
      })
      if (error) throw new Error(error.message)
      registered = true
    } catch (e: any) {
      console.error('[trial] registre indisponible, essai accordé', input.entityId, e?.message)
      decision = { granted: true, flags: [], previousAt: null }
    }
  } else console.error('[trial] aucune clé d\'empreinte (TRIAL_HASH_SECRET / CRON_SECRET) : essai accordé sans registre')
  await setTrialState(admin, input.entityId, decision.granted
    ? { trial_ends_at: trialEnd(now), trial_status: 'granted' }
    // Daté de la VEILLE : getTrialDaysLeft arrondit vers le haut, un essai fini depuis moins de 24 h compte encore « 0 jour »
    // (accès ouvert) ; un essai refusé ne doit donner aucune journée
    : { trial_ends_at: new Date(now.getTime() - DAY).toISOString(), trial_status: 'refused' })
  return { ...decision, registered }
}

/** Essai accordé à la main par l'administration (motif obligatoire) : 30 jours à partir de maintenant */
export async function grantTrialByAdmin(admin: any, entityId: string, adminId: string, reason: string, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from('trial_claims').insert({ entity_id: entityId, source: 'admin', granted: true, granted_by: adminId, reason })
  if (error) return { ok: false, error: error.message }
  await setTrialState(admin, entityId, { trial_ends_at: trialEnd(now), trial_status: 'granted' })
  return { ok: true }
}

/**
 * Reprise : entreprises sans ligne au registre dont le propriétaire a un numéro (boutique ou profil) → ligne
 * « backfill » datée de la création de l'entreprise (essai accordé à l'époque). Sans effet si déjà fait.
 * Appelée par la tâche du matin. Renvoie le nombre de lignes ajoutées.
 */
export async function backfillTrialClaims(admin: any, normalize: (raw: string, country: string | null) => string | null, limit = 200): Promise<number> {
  if (!keys().length) return 0
  const { data: done, error } = await admin.from('trial_claims').select('entity_id').not('entity_id', 'is', null)
  if (error) return 0
  const seen = new Set<string>((done || []).map((r: any) => r.entity_id))
  const { data: ents } = await admin.from('entities').select('id, owner_user_id, created_at, country').order('created_at', { ascending: true }).limit(2000)
  let added = 0
  for (const e of (ents || []) as any[]) {
    if (added >= limit) break
    if (seen.has(e.id) || !e.owner_user_id) continue
    const [{ data: shops }, { data: prof }] = await Promise.all([
      admin.from('shops').select('whatsapp, phone, country').eq('entity_id', e.id).order('created_at', { ascending: true }).limit(5),
      admin.from('profiles').select('phone, country').eq('id', e.owner_user_id).maybeSingle(),
    ])
    const candidates: [string | null, string | null][] = [
      ...((shops || []) as any[]).flatMap(s => [[s.whatsapp, s.country], [s.phone, s.country]] as [string | null, string | null][]),
      [prof?.phone ?? null, prof?.country ?? e.country ?? null],
    ]
    const phone = candidates.map(([raw, c]) => (raw ? normalize(raw, c) : null)).find(Boolean)
    if (!phone) continue
    const { error: insErr } = await admin.from('trial_claims').insert({
      entity_id: e.id, owner_user_id: e.owner_user_id, phone_hash: hashesOf(phone)[0], country: e.country ?? null,
      source: 'backfill', granted: true, created_at: e.created_at,
    })
    if (!insErr) added++
  }
  return added
}
