import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry } from '@/lib/saas/countries'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid, email as emailSchema, shortText } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { z } from 'zod'

const registerSchema = z.object({
  password: z.string().min(6),
  full_name: shortText,
  email: emailSchema,
  shop_name: shortText,
  city: shortText,
  phone: z.string().max(20).optional().nullable(),
  country: z.string().length(2).optional(),
  referral_code: z.string().max(20).optional().nullable(),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'register')
  if (limited) return limited

  try {
    const body = await request.json()
    const validated = validateBody(registerSchema, body)
    if ('error' in validated) return validated.error
    const { password, full_name, email, shop_name, city, phone, country, referral_code } = validated.data

    const supabase = await createAdminClient() as any

    const countryConfig = getCountry(country || 'NG')

    // Create the auth user server-side so the confirmation email only goes out
    // after shop + profile are successfully created (no orphan emails on failure).
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name },
    })
    if (authError || !authData?.user) {
      return NextResponse.json({ error: authError?.message || 'Erreur création compte' }, { status: 400 })
    }
    const user_id: string = authData.user.id

    // Validate referral code and get agent_id if provided
    let agentId: string | null = null
    if (referral_code) {
      const { data: agent } = await supabase
        .from('agents')
        .select('id')
        .eq('referral_code', referral_code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle()
      agentId = agent?.id ?? null
    }

    // Create shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .insert({
        name: shop_name,
        owner_id: user_id,
        city,
        state: city,
        whatsapp: phone || null,
        currency: countryConfig.currencySymbol,
        country: countryConfig.code,
        billing_country: countryConfig.code,
        plan: 'trial',
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        agent_id: agentId,
      } as any)
      .select('id')
      .single()

    const cleanup = async (shopId?: string) => {
      if (shopId) await supabase.from('shops').delete().eq('id', shopId)
      await supabase.auth.admin.deleteUser(user_id)
    }

    if (shopError || !shop) {
      await cleanup()
      return NextResponse.json({ error: shopError?.message || 'Erreur création boutique' }, { status: 500 })
    }

    // Create owner profile — store country + plan so billing is owner-level
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user_id,
        shop_id: shop.id,
        full_name,
        role: 'owner',
        is_active: true,
        country: countryConfig.code,
        plan: 'trial',
        trial_ends_at: trialEndsAt,
        plan_expires_at: null,
      } as any)

    if (profileError) {
      await cleanup(shop.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // Create shop_members entry so RLS lets the owner read their own shop
    const { error: memberError } = await supabase
      .from('shop_members')
      .insert({
        shop_id: shop.id,
        user_id,
        role: 'owner',
        is_active: true,
      } as any)

    if (memberError) {
      await cleanup(shop.id)
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }

    await writeAuditLog({
      action: 'account.register',
      shop_id: shop.id,
      actor_id: user_id,
      actor_email: email,
      target_id: shop.id,
      target_type: 'shop',
      metadata: { shop_name, country, city, referral_code: referral_code ?? null, agent_id: agentId },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, shop_id: shop.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
