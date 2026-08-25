import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

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
      'low_stock_threshold', 'tax_rate', 'expiry_alert_days', 'default_credit_term_days',
      'notify_email_low_stock', 'notify_email_daily', 'notify_email_expiry',
      'notify_push_new_sale', 'notify_push_new_expense', 'notify_push_expiry',
      ...HOURS_FIELDS,
    ] as const
    const updates: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in rawUpdates) updates[field] = rawUpdates[field]
    }

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

    const { error } = await admin.from('shops').update(updates).eq('id', shop_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
