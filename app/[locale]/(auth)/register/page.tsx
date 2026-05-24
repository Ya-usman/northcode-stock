'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Store, User, Mail, Lock, MapPin, Sun, Moon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { useTheme } from '@/lib/hooks/use-theme'

type FormData = {
  full_name: string
  email: string
  password: string
  confirm_password: string
  shop_name: string
  city: string
  phone?: string
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
)

export default function RegisterPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('register')
  const tAuth = useTranslations('auth')
  const router = useRouter()
  const { isDark, toggle } = useTheme()
  const { refreshShop } = useAuthContext()
  const supabase = createClient()
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [country, setCountry] = useState<CountryCode | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [sentToEmail, setSentToEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

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

  useEffect(() => {
    if (countdown === 0 && error) setError('')
  }, [countdown])

  const schema = z.object({
    full_name: z.string().min(2, t('name_required')),
    email: z.string().email(t('email_invalid')),
    password: z.string().min(8, t('password_min')),
    confirm_password: z.string().min(1, t('confirm_password_required')),
    shop_name: z.string().min(2, t('shop_name_required')),
    city: z.string().min(2, t('city_required')),
    phone: z.string().optional(),
  }).refine(d => d.password === d.confirm_password, {
    message: t('password_mismatch'),
    path: ['confirm_password'],
  })

  const { register, handleSubmit, formState: { errors, isSubmitting }, trigger } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard` },
    })
  }

  const signInWithApple = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard` },
    })
  }

  const handleResend = async () => {
    setResendLoading(true)
    setResendSuccess(false)
    await supabase.auth.resend({ type: 'signup', email: sentToEmail, options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard`,
    }})
    setResendLoading(false)
    setResendSuccess(true)
    setTimeout(() => setResendSuccess(false), 4000)
  }

  const goStep2 = async () => {
    const ok = await trigger(['full_name', 'email', 'password', 'confirm_password'])
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
    let authUserId: string | null = null
    try {
      await supabase.auth.signOut()
      localStorage.clear()
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: { full_name: data.full_name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}/login&signout=1&confirmed=1`,
        },
      })
      if (signUpError) throw signUpError
      if (!authData.user) throw new Error(t('account_error'))

      if (!authData.user.identities || authData.user.identities.length === 0) {
        await fetch('/api/cleanup-registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: authData.user.id }),
        }).catch(() => {})
        throw new Error(t('email_already_used'))
      }

      authUserId = authData.user.id

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

      if (authData.session) {
        await supabase.auth.refreshSession()
        await fetch('/api/auth/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        // Pre-load auth context before navigating so dashboard never shows skeleton
        await refreshShop()
        router.push(`/${locale}/dashboard`)
      } else {
        authUserId = null
        setSentToEmail(data.email)
        setEmailSent(true)
      }
    } catch (err: any) {
      if (authUserId) {
        fetch('/api/cleanup-registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: authUserId }),
        }).catch(() => {})
      }

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

  const wrapperCls = "min-h-screen overflow-y-auto flex items-center justify-center bg-gradient-to-br from-stockshop-blue via-stockshop-blue-light to-blue-800 p-4 py-8"
  const themeBtn = (
    <button onClick={toggle} className="fixed top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm transition-colors">
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
  const logoBlock = (
    <div className="flex flex-col items-center mb-6">
      <Link href={`/${locale}`} onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) e.preventDefault() }}>
        <img src="/logo-login-t.png" alt="StockShop" className="h-36 w-auto object-contain" style={{ filter: 'brightness(0) invert(1) drop-shadow(0 8px 24px rgba(0,0,0,0.55))' }} />
      </Link>
      <p className="text-blue-200 text-sm mt-2">{t('trial_note')}</p>
    </div>
  )

  if (emailSent) {
    return (
      <div className={wrapperCls}>
        {themeBtn}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
          {logoBlock}
          <div className="rounded-2xl bg-card dark:bg-[#0d2a5e] shadow-2xl overflow-hidden p-8 text-center space-y-4">
            <div className="text-6xl">📧</div>
            <div>
              <h2 className="text-xl font-bold">{t('email_sent_title')}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {t('email_sent_desc')}{' '}
                <span className="font-semibold text-foreground break-all">{sentToEmail}</span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{t('email_sent_note')}</p>
            <div className="space-y-2 pt-2">
              <Button
                onClick={handleResend}
                loading={resendLoading}
                variant="outline"
                className="w-full"
              >
                {resendSuccess ? t('resent_success') : t('resend_email')}
              </Button>
              <Link
                href={`/${locale}/login`}
                className="block text-sm text-stockshop-blue dark:text-blue-400 hover:underline"
              >
                {t('go_to_login')}
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className={wrapperCls}>
      {themeBtn}

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">

        <div className="rounded-2xl bg-card dark:bg-[#0d2a5e] shadow-2xl overflow-hidden">
          <div className="p-6">
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-5">
              <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 1 ? 'bg-stockshop-blue' : 'bg-muted'}`} />
              <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 2 ? 'bg-stockshop-blue' : 'bg-muted'}`} />
              <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 3 ? 'bg-stockshop-blue' : 'bg-muted'}`} />
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">

              {/* Step 1 — Compte */}
              {step === 1 && (
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
                  <h2 className="font-semibold text-lg mb-1">{t('account_section')}</h2>

                  <div className="space-y-1.5">
                    <Label>{t('full_name')}</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input {...register('full_name')} placeholder="Malam Usman"
                        className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30" />
                    </div>
                    {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('email')}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input {...register('email')} type="email" placeholder="vous@email.com"
                        className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30" />
                    </div>
                    {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('password')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input
                        {...register('password')}
                        type={showPwd ? 'text' : 'password'}
                        placeholder={t('password_min')}
                        className="pl-9 pr-10 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                      />
                      <button type="button" onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground dark:text-gray-500 hover:text-foreground dark:hover:text-gray-700">
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('confirm_password')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input
                        {...register('confirm_password')}
                        type={showConfirmPwd ? 'text' : 'password'}
                        placeholder={t('confirm_password_placeholder')}
                        className="pl-9 pr-10 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                      />
                      <button type="button" onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground dark:text-gray-500 hover:text-foreground dark:hover:text-gray-700">
                        {showConfirmPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.confirm_password && <p className="text-xs text-destructive">{errors.confirm_password.message}</p>}
                  </div>

                  <Button type="button" onClick={goStep2} className="w-full bg-stockshop-blue hover:bg-stockshop-blue-light h-11 text-base">
                    {t('next')}
                  </Button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex-1 h-px bg-border dark:bg-white/20" />
                    <span className="text-xs text-muted-foreground">{tAuth('or_separator')}</span>
                    <div className="flex-1 h-px bg-border dark:bg-white/20" />
                  </div>

                  {/* OAuth côte à côte */}
                  <div className="flex gap-2">
                    <button type="button" onClick={signInWithGoogle}
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-gray-200 dark:border-white/20 bg-white dark:bg-white/10 hover:bg-gray-50 dark:hover:bg-white/15 text-gray-700 dark:text-white font-medium text-sm transition-colors">
                      <GoogleIcon /> Google
                    </button>
                    <button type="button" onClick={signInWithApple}
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-gray-200 dark:border-white/20 bg-white dark:bg-white/10 hover:bg-gray-50 dark:hover:bg-white/15 text-gray-700 dark:text-white font-medium text-sm transition-colors">
                      <AppleIcon /> Apple
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Step 2 — Pays */}
              {step === 2 && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
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
                    <Button type="button" onClick={goStep3} disabled={!country} className="flex-1 bg-stockshop-blue">
                      {t('next')}
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Step 3 — Boutique */}
              {step === 3 && selectedCountry && (
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-lg">{t('shop_section')}</h2>
                    <span className="text-lg">{selectedCountry.flag}</span>
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('shop_name')}</Label>
                    <div className="relative">
                      <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input {...register('shop_name')} placeholder="Boutique Alhaji Musa"
                        className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30" />
                    </div>
                    {errors.shop_name && <p className="text-xs text-destructive">{errors.shop_name.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('shop_city')}</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input {...register('city')} placeholder={selectedCountry.cityPlaceholder}
                        className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30" />
                    </div>
                    {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>{t('phone')} <span className="text-muted-foreground text-xs">({t('optional')})</span></Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">{selectedCountry.phonePrefix}</span>
                      <Input {...register('phone')} placeholder="XXXXXXXXXX"
                        className="pl-14 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30" />
                    </div>
                  </div>

                  {error && (
                    <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">
                      {countdown > 0 ? t('rate_limit', { seconds: countdown }) : error}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1">{t('back')}</Button>
                    <Button
                      type="submit"
                      loading={isSubmitting}
                      disabled={isSubmitting || countdown > 0}
                      className="flex-1 bg-stockshop-blue"
                    >
                      {t('create_shop')}
                    </Button>
                  </div>
                </motion.div>
              )}
            </form>
          </div>
        </div>

        <p className="text-center text-blue-200 text-sm mt-4">
          {t('already_have_account')}{' '}
          <Link href={`/${locale}/login`} className="text-white font-semibold hover:underline">
            {t('login_link')}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
