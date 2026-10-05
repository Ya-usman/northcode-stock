import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { normalizeCurrency, currencyCodeForCountry } from '@/lib/saas/currencies'
import { validateShopIdentity, isShopCodeTaken, SHOP_IDENTITY_FIELDS } from '@/lib/saas/shop-identity'
import { resolveAccountOwnerId } from '@/lib/saas/team-quota'
import { getOwnerShopIds } from '@/lib/api/shop-auth'

const HOURS_FIELDS = ['hours_enabled', 'opening_time', 'closing_time', 'hours_manual_override'] as const

// PATCH /api/shops/settings — mise à jour des paramètres de la boutique (nom, ville, notifications...)
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, ...rawUpdates } = await request.json()
    if (!shop_id) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!rawUpdates.name?.trim()) return NextResponse.json({ error: t('shop_name_field_required') }, { status: 400 })

    // Liste blanche stricte : sans elle, un propriétaire authentifié pourrait glisser
    // n'importe quelle colonne (billing_country, plan, plan_expires_at, trial_ends_at,
    // owner_id...) dans le corps de la requête et se l'écrire directement en base via
    // le client admin ci-dessous, qui contourne RLS. billing_country reste volontairement
    // exclu — figé à l'inscription, seul le super_admin le modifie (cf. migration 064).
    const ALLOWED_FIELDS = [
      'name', 'city', 'state', 'country', 'currency', 'whatsapp',
      'receipt_tagline', 'receipt_legal_ids', 'receipt_footer',
      'low_stock_threshold', 'tax_rate', 'expiry_alert_days', 'default_credit_term_days',
      'notify_email_low_stock', 'notify_email_daily', 'notify_email_expiry',
      'notify_push_new_sale', 'notify_push_new_expense', 'notify_push_expiry',
      ...HOURS_FIELDS,
    ] as const
    const updates: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in rawUpdates) updates[field] = rawUpdates[field]
    }

    // Textes imprimés sur les reçus (migration 149) : chaîne ou null, bornés comme
    // en base (CHECK) pour renvoyer un message clair plutôt qu'une erreur SQL.
    const RECEIPT_TEXT_MAX: Record<string, number> = { receipt_tagline: 80, receipt_legal_ids: 300, receipt_footer: 200 }
    for (const [field, max] of Object.entries(RECEIPT_TEXT_MAX)) {
      if (!(field in updates)) continue
      const v = updates[field]
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json({ error: t('invalid_receipt_text') }, { status: 400 })
      }
      const clean = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : ''
      if (clean.length > max) {
        return NextResponse.json({ error: t('receipt_text_too_long') }, { status: 400 })
      }
      updates[field] = clean || null
    }

    // Identité de la boutique (migration 152) : code, adresse, téléphone, e-mail
    const identity = validateShopIdentity(rawUpdates)
    const identityError = Object.entries(identity.errors)[0]
    if (identityError) return NextResponse.json({ error: t(identityError[1] as any), field: identityError[0] }, { status: 400 })
    Object.assign(updates, identity.values)

    if ('hours_manual_override' in updates) {
      const v = updates.hours_manual_override
      if (v !== null && v !== 'open' && v !== 'closed') {
        return NextResponse.json({ error: t('invalid_hours_override') }, { status: 400 })
      }
    }

    // Only the owner can update shop settings
    const { data: member } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!member || !['owner', 'super_admin'].includes(member.role)) {
      return NextResponse.json({ error: t('owner_only_settings') }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    // ── Devise / pays (V3) ────────────────────────────────────────────────
    // La devise est toujours un CODE ISO en base. On normalise ce qui arrive
    // (compat : le frontend envoie déjà un code depuis la Phase B, mais un
    // vieux client pourrait envoyer un symbole). On BLOQUE un changement de
    // devise sur une boutique qui a déjà un historique financier (§10) —
    // aucune conversion automatique de l'historique. Le super_admin garde
    // la main pour un cas légitime.
    if ('currency' in updates || 'country' in updates) {
      const { data: current } = await admin
        .from('shops').select('currency, country').eq('id', shop_id).single()

      const nextCountry = ('country' in updates ? updates.country : current?.country) as string | null

      // Devise explicitement fournie par le client → doit être reconnue telle
      // quelle (code ISO, symbole non ambigu, ou variante CFA levée par le
      // pays). Si SEUL le pays change, on re-dérive la devise du nouveau pays.
      const iso = 'currency' in updates
        ? normalizeCurrency(updates.currency as string | null, nextCountry)
        : currencyCodeForCountry(nextCountry)
      if (!iso) {
        return NextResponse.json({ error: t('invalid_currency') }, { status: 400 })
      }
      updates.currency = iso

      // `current.currency` est déjà un code ISO (migration 141). Un simple
      // écart de code suffit à détecter un vrai changement de devise.
      const currencyChanges = iso !== (current?.currency ?? null)

      if (currencyChanges && member.role !== 'super_admin') {
        const [{ count: salesCount }, { count: expensesCount }] = await Promise.all([
          admin.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', shop_id),
          admin.from('expenses').select('id', { count: 'exact', head: true }).eq('shop_id', shop_id),
        ])
        if ((salesCount ?? 0) > 0 || (expensesCount ?? 0) > 0) {
          return NextResponse.json({ error: t('currency_change_blocked_history') }, { status: 403 })
        }
      }
    }

    // Les horaires ont besoin de l'état actuel : pour valider fermeture >
    // ouverture même si un seul des deux champs est envoyé dans cette
    // requête, et pour ne journaliser que si l'un des 4 champs change
    // réellement (cette route n'audite aucun autre champ aujourd'hui).
    const touchesHours = HOURS_FIELDS.some(f => f in updates)
    let currentHours: Record<string, unknown> | null = null
    if (touchesHours) {
      const { data } = await admin.from('shops').select(HOURS_FIELDS.join(',')).eq('id', shop_id).single()
      currentHours = data
    }

    let hoursChanged = false
    if (touchesHours) {
      const effectiveEnabled = 'hours_enabled' in updates ? updates.hours_enabled : currentHours?.hours_enabled
      const effectiveOpening = ('opening_time' in updates ? updates.opening_time : currentHours?.opening_time) as string | null
      const effectiveClosing = ('closing_time' in updates ? updates.closing_time : currentHours?.closing_time) as string | null
      if (effectiveEnabled && effectiveOpening && effectiveClosing && effectiveClosing <= effectiveOpening) {
        return NextResponse.json({ error: t('closing_after_opening') }, { status: 400 })
      }

      hoursChanged = HOURS_FIELDS.some(f => f in updates && updates[f] !== currentHours?.[f])
      // Un changement d'horaire délibéré par le owner efface toute
      // prolongation en cours (accordée par un manager) et remet le quota
      // du jour à zéro — sinon une prolongation plus ancienne pourrait
      // silencieusement annuler la correction du owner.
      if (hoursChanged) {
        updates.hours_extension_until = null
        updates.hours_extension_count = 0
        updates.hours_extension_count_date = null
      }
    }

    // Code unique dans le compte + valeurs avant pour le journal
    const INFO_FIELDS = ['name', 'city', 'country', ...SHOP_IDENTITY_FIELDS] as const
    const touchesInfo = SHOP_IDENTITY_FIELDS.some(f => f in identity.values)
    let currentInfo: Record<string, unknown> | null = null
    if (touchesInfo) {
      const { data } = await admin.from('shops').select(INFO_FIELDS.join(',')).eq('id', shop_id).maybeSingle()
      currentInfo = data
      if (identity.values.code && identity.values.code !== currentInfo?.code) {
        const ownerId = await resolveAccountOwnerId(admin, shop_id)
        const ownerShopIds = ownerId ? await getOwnerShopIds(admin, ownerId) : []
        if (await isShopCodeTaken(admin, ownerShopIds, identity.values.code, shop_id)) {
          return NextResponse.json({ error: t('shop_code_taken'), field: 'code' }, { status: 409 })
        }
      }
    }

    const { error } = await admin.from('shops').update(updates).eq('id', shop_id)
    if (error) {
      if ((error as any).code === '23505') return NextResponse.json({ error: t('shop_code_taken'), field: 'code' }, { status: 409 })
      if (touchesInfo && /column .* does not exist|schema cache/i.test(error.message)) return NextResponse.json({ error: t('migration_required') }, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (touchesInfo && currentInfo) {
      const changed = INFO_FIELDS.filter(f => f in updates && (updates[f] ?? null) !== (currentInfo![f] ?? null))
      if (changed.length) {
        await writeAuditLog({
          action: 'shop.update_info',
          shop_id,
          actor_id: user.id,
          actor_email: user.email,
          target_id: shop_id,
          target_type: 'shop',
          metadata: {
            before: Object.fromEntries(changed.map(f => [f, currentInfo![f] ?? null])),
            after: Object.fromEntries(changed.map(f => [f, updates[f] ?? null])),
          },
          ip: getClientIp(request),
        })
      }
    }

    if (hoursChanged && currentHours) {
      await writeAuditLog({
        action: 'shop.update_hours',
        shop_id,
        actor_id: user.id,
        actor_email: user.email,
        target_id: shop_id,
        target_type: 'shop',
        metadata: {
          before: currentHours,
          after: Object.fromEntries(HOURS_FIELDS.map(f => [f, f in updates ? updates[f] : currentHours![f]])),
        },
        ip: getClientIp(request),
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
