'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, Sun, Moon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { setLocaleCookie } from '@/lib/utils/cookies'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTheme } from '@/lib/hooks/use-theme'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  rememberMe: z.boolean().default(false),
})

const forgotSchema = z.object({
  email: z.string().email(),
})

type LoginData = z.infer<typeof loginSchema>
type ForgotData = z.infer<typeof forgotSchema>

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

export default function LoginPage({ params: { locale }, searchParams }: { params: { locale: string }, searchParams: { error?: string, confirmed?: string } }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const supabase = createClient()
  const { isDark, toggle } = useTheme()
  const [showPwd, setShowPwd] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [error, setError] = useState(
    searchParams?.error === 'no_profile' ? 'Account not configured yet. Contact your administrator.' :
    searchParams?.error === 'inactive' ? 'Your account has been deactivated. Contact your administrator.' :
    searchParams?.error === 'use_email' ? 'Un compte existe déjà avec cet email. Connectez-vous avec votre email et mot de passe.' :
    searchParams?.error ? `Erreur OAuth : ${searchParams.error}` :
    ''
  )
  const [success, setSuccess] = useState(
    searchParams?.confirmed === '1' ? 'Adresse e-mail confirmée ! Vous pouvez maintenant vous connecter.' : ''
  )

  useEffect(() => {
    if (searchParams?.confirmed === '1') {
      supabase.auth.signOut().catch(() => {})
    }
  }, [])

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  })
  const forgotForm = useForm<ForgotData>({ resolver: zodResolver(forgotSchema) })

  const onLogin = async (data: LoginData) => {
    setError('')
    localStorage.removeItem('auth_cache_v1')
    localStorage.removeItem('active_shop_id')
    localStorage.removeItem('dashboard_cache_v1')
    localStorage.removeItem('dashboard_shop_filter')
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password })
    if (error) { setError(t('invalid_credentials')); return }
    localStorage.setItem('auth_remember_me', data.rememberMe ? '1' : '0')
    sessionStorage.setItem('session_alive', '1')
    await fetch('/api/auth/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const { data: profileData } = await supabase.from('profiles').select('locale').eq('id', authData.user.id).single()
    const preferredLocale = profileData?.locale || document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] || localStorage.getItem('NEXT_LOCALE') || locale
    localStorage.setItem('NEXT_LOCALE', preferredLocale)
    setLocaleCookie(preferredLocale)
    router.push(`/${preferredLocale}/dashboard`)
  }

  const signInWithGoogle = async () => {
    setError('')
    localStorage.setItem('auth_remember_me', '1')
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    // On Capacitor: redirectTo uses custom scheme so Chrome Custom Tab renvoie dans l'app via deep link
    const redirectTo = isNative
      ? 'stockshop://auth/callback'
      : `${window.location.origin}/auth/callback?next=/${locale}/dashboard`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  }

  const signInWithApple = async () => {
    setError('')
    localStorage.setItem('auth_remember_me', '1')
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    const redirectTo = isNative
      ? 'stockshop://auth/callback'
      : `${window.location.origin}/auth/callback?next=/${locale}/dashboard`
    await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo } })
  }

  const onForgot = async (data: ForgotData) => {
    setError('')
    const loc = window.location.pathname.split('/')[1] || 'fr'
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/${loc}/reset-password`,
    })
    if (error) { setError(error.message); return }
    setSuccess(t('reset_sent'))
  }

  return (
    <div className="min-h-screen overflow-y-auto flex items-center justify-center bg-gradient-to-br from-stockshop-blue via-stockshop-blue-light to-blue-800 p-4 py-8">
      <button
        onClick={toggle}
        className="fixed top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm transition-colors"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <Link href={`/${locale}`} onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) e.preventDefault() }}>
            <img src="/logo-login-t.png" alt="StockShop" className="h-36 w-auto object-contain" style={{ filter: 'brightness(0) invert(1) drop-shadow(0 8px 24px rgba(0,0,0,0.55))' }} />
          </Link>
          <p className="text-blue-200 text-sm mt-2">
            {locale === 'ha' ? 'Lissafin kaya mai wayo' : 'Smart inventory management'}
          </p>
        </div>

        <div className="rounded-2xl bg-card dark:bg-[#0d2a5e] shadow-2xl overflow-hidden">
          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              <motion.div key="login" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="p-6">
                <h2 className="text-xl font-semibold mb-1">{t('welcome_back')}</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  {locale === 'ha' ? 'Shigar da imelinka da kalmar sirri' : 'Sign in to your account'}
                </p>

                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{t('email')}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input id="email" type="email" autoComplete="email" placeholder="admin@stockshop.ng"
                        className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                        {...loginForm.register('email')} />
                    </div>
                    {loginForm.formState.errors.email && <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password">{t('password')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                      <Input id="password" type={showPwd ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                        className="pl-9 pr-10 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                        {...loginForm.register('password')} />
                      <button type="button" onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground dark:text-gray-500 hover:text-foreground dark:hover:text-gray-700">
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded border-border" {...loginForm.register('rememberMe')} />
                      <span className="text-muted-foreground">{t('remember_me')}</span>
                    </label>
                    <button type="button" onClick={() => { setMode('forgot'); setError('') }}
                      className="text-stockshop-blue dark:text-blue-400 hover:underline font-medium">
                      {t('forgot_password')}
                    </button>
                  </div>

                  {success && <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 rounded-md p-2 text-center">✓ {success}</p>}
                  {error && <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">{error}</p>}

                  <Button type="submit" className="w-full bg-stockshop-blue hover:bg-stockshop-blue-light h-11 text-base" loading={loginForm.formState.isSubmitting}>
                    {loginForm.formState.isSubmitting ? t('logging_in') : t('login')}
                  </Button>

                  {/* Divider */}
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex-1 h-px bg-border dark:bg-white/20" />
                    <span className="text-xs text-muted-foreground">{t('or_separator')}</span>
                    <div className="flex-1 h-px bg-border dark:bg-white/20" />
                  </div>

                  {/* OAuth — côte à côte */}
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
                </form>
              </motion.div>
            ) : (
              <motion.div key="forgot" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6">
                <h2 className="text-xl font-semibold mb-1">{t('forgot_password')}</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  {locale === 'ha' ? 'Shigar da imelinka don sake saita kalmar sirri' : 'Enter your email to reset your password'}
                </p>

                {success ? (
                  <div className="text-center py-4">
                    <div className="text-5xl mb-3">📧</div>
                    <p className="text-sm text-green-700 bg-green-50 rounded-md p-3">{success}</p>
                    <button onClick={() => { setMode('login'); setSuccess(''); forgotForm.reset() }}
                      className="mt-4 text-sm text-stockshop-blue dark:text-blue-400 hover:underline">
                      {t('back_to_login')}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={forgotForm.handleSubmit(onForgot)} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="reset-email">{t('email')}</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                        <Input id="reset-email" type="email" placeholder="your@email.com"
                          className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                          {...forgotForm.register('email')} />
                      </div>
                    </div>

                    {error && <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">{error}</p>}

                    <Button type="submit" className="w-full bg-stockshop-blue hover:bg-stockshop-blue-light h-11" loading={forgotForm.formState.isSubmitting}>
                      {t('send_reset_link')}
                    </Button>

                    <button type="button" onClick={() => { setMode('login'); setError('') }}
                      className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
                      ← {t('back_to_login')}
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-blue-200 text-sm mt-4">
          {t('no_account')}{' '}
          <Link href={`/${locale}/register`} className="text-white font-semibold hover:underline">{t('register_link')}</Link>
        </p>
        <p className="text-center text-blue-200 text-xs mt-2">StockShop Manager · Built for Africa</p>
      </motion.div>
    </div>
  )
}
