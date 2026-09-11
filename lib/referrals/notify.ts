import { createTranslator } from 'next-intl'
import { formatCurrency } from '@/lib/utils/currency'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import ha from '@/messages/ha.json'

const CATALOGS = { fr, en, ha } as const
type NotifLocale = keyof typeof CATALOGS

export type ReferralNotifEvent =
  | 'new_referral'      // un filleul vient de s'inscrire avec le code
  | 'reward_pending'    // le filleul est devenu client — récompense en attente de validation
  | 'reward_available'  // la période de validation est écoulée — récompense utilisable
  | 'reward_used'       // le parrain a payé une partie de son abonnement avec ses gains
  | 'payout_approved'   // l'admin a approuvé une demande de retrait
  | 'payout_paid'       // le retrait a été payé
  | 'reward_cancelled'  // une récompense a été annulée (remboursement / modération)

const EVENT_TYPE: Record<ReferralNotifEvent, 'info' | 'warning'> = {
  new_referral:     'info',
  reward_pending:   'info',
  reward_available: 'info',
  reward_used:      'info',
  payout_approved:  'info',
  payout_paid:      'info',
  reward_cancelled: 'warning',
}

/**
 * "₦2,000" / "2 000 F CFA" — montant lisible pour le corps d'une
 * notification. `currency` est un code ISO (`NGN`, `XOF`…). Formatage
 * centralisé (`formatCurrency`) — même rendu que partout ailleurs.
 */
export function formatRefAmount(amount: number | string, currency: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  const rounded = Number.isFinite(n) ? Math.round(n) : 0
  return formatCurrency(rounded, currency)
}

/**
 * Insère une notification in-app localisée pour un parrain — réutilise
 * entièrement l'infra existante `admin_notifications` + `notification-bell.tsx`
 * (Realtime, toast, badge, marquage lu déjà en place, voir migration 039 / 125).
 *
 * La notification est indexée par `shop_id` : on cible la boutique principale
 * du parrain (`profiles.shop_id`, sinon la 1re boutique dont il est owner
 * actif) — la même que celle affichée par la cloche.
 *
 * NON BLOQUANT : toute erreur est avalée et journalisée. Un souci ici prive
 * seulement le parrain d'une notification, jamais d'une récompense.
 */
export async function notifyReferral(
  admin: any,
  params: { userId: string; event: ReferralNotifEvent; vars?: Record<string, string | number> },
): Promise<void> {
  try {
    const { data: profile } = await admin
      .from('profiles').select('locale, shop_id').eq('id', params.userId).maybeSingle()

    let shopId: string | null = profile?.shop_id ?? null
    if (!shopId) {
      const { data: member } = await admin
        .from('shop_members').select('shop_id')
        .eq('user_id', params.userId).eq('role', 'owner').eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle()
      shopId = member?.shop_id ?? null
    }
    if (!shopId) return

    const locale: NotifLocale =
      profile?.locale === 'en' || profile?.locale === 'ha' ? profile.locale : 'fr'
    const t = createTranslator({ locale, messages: CATALOGS[locale], namespace: 'referrals' })

    await admin.from('admin_notifications').insert({
      shop_id: shopId,
      type: EVENT_TYPE[params.event],
      title: t(`notif_${params.event}_title`, params.vars ?? {}),
      message: t(`notif_${params.event}_body`, params.vars ?? {}),
    })
  } catch (err: any) {
    console.error('[notifyReferral]', err?.message)
  }
}
