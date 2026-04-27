'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Store, User, Phone, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { ForceLight } from '@/components/force-light'

type FormData = {
  full_name: string
  email: string
  password: string
  shop_name: string
  city: string
  phone?: string
}

export default function RegisterPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('register')
  const router = useRouter()
  const supabase = createClient()
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [country, setCountry] = useState<CountryCode | null>(null)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) return 0
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  // Clear error when rate-limit countdown ends
  useEffect(() => {
    if (countdown === 0 && error) setError('')
  }, [countdown])

  const schema = z.object({
    full_name: z.string().min(2, t('name_required')),
    email: z.string().email(t('email_invalid')),
    password: z.string().min(8, t('password_min')),
    shop_name: z.string().min(2, t('shop_name_required')),
    city: z.string().min(2, t('city_required')),
    phone: z.string().optional(),
  })

  const { register, handleSubmit, formState: { errors, isSubmitting }, trigger } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const goStep2 = async () => {
    const ok = await trigger(['full_name', 'email', 'password'])
    if (ok) setStep(2)
  }

  const goStep3 = () => {
    if (!country) return
    setStep(3)
  }

  const onSubmit = async (data: FormData) => {
    if (!country) return
    setError('')
    setCountdown(0)
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { full_name: data.full_name } },
      })
      if (signUpError) throw signUpError
      if (!authData.user) throw new Error(t('account_error'))

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authData.session?.access_token
            ? { Authorization: `Bearer ${authData.session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          user_id: authData.user.id,
          full_name: data.full_name,
          email: data.email,
          shop_name: data.shop_name,
          city: data.city,
          phone: data.phone || null,
          country,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || t('account_error'))
      }

      document.cookie = `user_role=owner; path=/; max-age=3600`
      await supabase.auth.refreshSession()
      router.push(`/${locale}/dashboard`)
    } catch (err: any) {
      const msg: string = err.message || ''
      const secondsMatch = msg.match(/(\d+)\s*second/i)
      if (secondsMatch) {
        const secs = parseInt(secondsMatch[1])
        setCountdown(secs)
        setError(t('rate_limit', { seconds: secs }))
      } else {
        setError(msg)
      }
    }
  }

  const selectedCountry = country ? COUNTRIES[country] : null

  return (
    <ForceLight>
    <div className="min-h-screen overflow-y-auto flex items-center justify-center bg-gradient-to-br from-northcode-blue via-northcode-blue-light to-blue-800 p-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-5">
          <Link href={`/${locale}`} onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) e.preventDefault() }}>
            <img src="/logo-login-t.png" alt="StockShop" className="h-40 w-auto object-contain brightness-0 invert drop-shadow-lg" />
          </Link>
          <h1 className="text-xl font-bold text-white mt-3">{t('page_title')}</h1>
          <p className="text-blue-200 text-sm mt-1">{t('trial_note')}</p>
        </div>

        <div className="rounded-2xl bg-card shadow-2xl p-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 1 ? 'bg-northcode-blue' : 'bg-muted'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 2 ? 'bg-northcode-blue' : 'bg-muted'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 3 ? 'bg-northcode-blue' : 'bg-muted'}`} />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* Step 1 — Compte */}
            {step === 1 && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <h2 className="font-semibold text-lg">{t('account_section')}</h2>

                <div className="space-y-1.5">
                  <Label>{t('full_name')}</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('full_name')} placeholder="Malam Usman" className="pl-9" />
                  </div>
                  {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>{t('email')}</Label>
                  <Input {...register('email')} type="email" placeholder="vous@email.com" />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>{t('password')}</Label>
                  <div className="relative">
                    <Input
                      {...register('password')}
                      type={showPwd ? 'text' : 'password'}
                      placeholder={t('password_min')}
                      className="pr-10"
                    />
                    <button type="button" onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>

                <Button type="button" onClick={goStep2} className="w-full bg-northcode-blue h-11">
                  {t('next')}
                </Button>
              </motion.div>
            )}

            {/* Step 2 — Pays */}
            {step === 2 && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div>
                  <h2 className="font-semibold text-lg">{t('country')}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('country_subtitle')}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(Object.values(COUNTRIES)).map(c => {
                    const selected = country === c.code
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setCountry(c.code)}
                        className="flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all"
                        style={selected
                          ? { borderColor: c.flagColor, backgroundColor: `${c.flagColor}15` }
                          : { borderColor: `${c.flagColor}55` }
                        }
                      >
                        <span className="text-4xl">{c.flag}</span>
                        <div className="text-center">
                          <p className="font-semibold text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.currencySymbol}</p>
                        </div>
                        {selected && (
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: c.flagColor }} />
                        )}
                      </button>
                    )
                  })}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">{t('back')}</Button>
                  <Button type="button" onClick={goStep3} disabled={!country} className="flex-1 bg-northcode-blue">
                    {t('next')}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3 — Boutique */}
            {step === 3 && selectedCountry && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-lg">{t('shop_section')}</h2>
                  <span className="text-lg">{selectedCountry.flag}</span>
                </div>

                <div className="space-y-1.5">
                  <Label>{t('shop_name')}</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('shop_name')} placeholder="Boutique Alhaji Musa" className="pl-9" />
                  </div>
                  {errors.shop_name && <p className="text-xs text-destructive">{errors.shop_name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>{t('shop_city')}</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('city')} placeholder={selectedCountry.cityPlaceholder} className="pl-9" />
                  </div>
                  {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>{t('phone')} <span className="text-muted-foreground text-xs">({t('optional')})</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">{selectedCountry.phonePrefix}</span>
                    <Input {...register('phone')} placeholder="XXXXXXXXXX" className="pl-14" />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-red-50 rounded-md p-2 text-center">
                    {countdown > 0
                      ? t('rate_limit', { seconds: countdown })
                      : error}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1">{t('back')}</Button>
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={isSubmitting || countdown > 0}
                    className="flex-1 bg-northcode-blue"
                  >
                    {t('create_shop')}
                  </Button>
                </div>
              </motion.div>
            )}
          </form>
        </div>

        <p className="text-center text-blue-200 text-sm mt-4">
          {t('already_have_account')}{' '}
          <Link href={`/${locale}/login`} className="text-white font-medium hover:underline">
            {t('login_link')}
          </Link>
        </p>
      </motion.div>
    </div>
    </ForceLight>
  )
}
