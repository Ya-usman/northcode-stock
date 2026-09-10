// Configuration centrale du programme de parrainage (referral_program_config,
// une seule ligne — migration 127). Un seul point de lecture pour que le
// pourcentage/la fenêtre/le minimum de retrait ne soient jamais codés en dur
// ailleurs dans le code.
export interface ReferralConfig {
  enabled: boolean
  reward_percentage: number
  validation_days: number
  association_window_days: number
  min_payout_by_currency: Record<string, number>
  eligible_plans: string[]
  eligible_countries: string[] | null
}

const CONFIG_ROW_ID = '00000000-0000-0000-0000-000000000001'

export async function getReferralConfig(admin: any): Promise<ReferralConfig> {
  const { data } = await admin
    .from('referral_program_config')
    .select('*')
    .eq('id', CONFIG_ROW_ID)
    .maybeSingle()

  // Repli sûr si la ligne de config manquait (ne devrait pas arriver, la
  // migration l'amorce) — désactivé par défaut plutôt que de planter.
  return {
    enabled: data?.enabled ?? false,
    reward_percentage: Number(data?.reward_percentage ?? 20),
    validation_days: data?.validation_days ?? 7,
    association_window_days: data?.association_window_days ?? 14,
    min_payout_by_currency: data?.min_payout_by_currency ?? {},
    eligible_plans: data?.eligible_plans ?? ['starter', 'pro', 'business'],
    eligible_countries: data?.eligible_countries ?? null,
  }
}
