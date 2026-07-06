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
    searchParams?.error === 'lien_invalide' ? 'Lien expiré ou déjà utilisé. Ouvre le lien de confirmation sur le même téléphone où tu t\'es inscrit(e), ou redemande un email de confirmation.' :
    searchParams?.error ? `Erreur : ${searchParams.error}` :
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
    // Effacer uniquement les caches auth — PAS les caches SW (pages/assets/RSC)
    // dashboard_cache_v1 intentionally NOT cleared: its key includes profile.id
    // so a different user's data is never shown; keeping it avoids the skeleton
    // flash that occurs when the dashboard mounts after auth resolves.
    // clearReadCaches() in auth-context clears it properly on SIGNED_OUT.
    localStorage.removeItem('auth_cache_v1')
    localStorage.removeItem('active_shop_id')
    localStorage.removeItem('dashboard_shop_filter')

    // 2 tentatives max avec timeout 10s par tentative.
    // Sans timeout, supabase.auth.signInWithPassword peut bloquer indéfiniment
    // si Supabase est lent au démarrage (cold start) — le fetch API n'a pas de
    // timeout intégré. On utilise AbortController pour forcer l'annulation.
    const attemptLogin = (): Promise<{ data: any; error: any }> =>
      new Promise((resolve) => {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), 10_000)
        supabase.auth.signInWithPassword({ email: data.email, password: data.password })
          .then(res => { clearTimeout(tid); resolve(res) })
          .catch(err => { clearTimeout(tid); resolve({ data: null, error: err }) })
        // If abort fires before the promise resolves, treat as network error
        controller.signal.addEventListener('abort', () =>
          resolve({ data: null, error: { message: 'Request timeout', status: 0 } })
        , { once: true })
      })

    let authData: any = null
    let lastError: any = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: d, error: e } = await attemptLogin()
      if (!e) { authData = d; break }
      lastError = e
      const isNetworkError = !e.status || e.status === 0 || e.message?.toLowerCase().includes('fetch') || e.message?.toLowerCase().includes('network') || e.message?.toLowerCase().includes('failed') || e.message?.toLowerCase().includes('timeout')
      // Mauvais identifiants → inutile de réessayer
      if (!isNetworkError) break
      // Erreur réseau → attendre 2s puis une dernière tentative
      if (attempt < 1) await new Promise(r => setTimeout(r, 2000))
    }

    if (!authData) {
      const isNetworkError = !lastError?.status || lastError?.status === 0 || lastError?.message?.toLowerCase().includes('fetch') || lastError?.message?.toLowerCase().includes('network') || lastError?.message?.toLowerCase().includes('failed')
      setError(isNetworkError
        ? (locale === 'ha' ? 'Matsalar hanyar sadarwa. Da fatan a sake gwadawa.' : 'Problème de connexion. Vérifiez votre réseau et réessayez.')
        : t('invalid_credentials'))
      return
    }

    localStorage.setItem('auth_remember_me', data.rememberMe ? '1' : '0')
    sessionStorage.setItem('session_alive', '1')
    // Fire-and-forget — ne pas bloquer la navigation sur le cold start Vercel
    fetch('/api/auth/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    // Utiliser la locale déjà connue — l'auth context la synchro depuis la DB en arrière-plan
    const preferredLocale = document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] || localStorage.getItem('NEXT_LOCALE') || locale
    localStorage.setItem('NEXT_LOCALE', preferredLocale)
    setLocaleCookie(preferredLocale)
    router.replace(`/${preferredLocale}/dashboard`)
  }

  const signInWithOAuthNative = async (provider: 'google' | 'apple') => {
    setError('')
    localStorage.setItem('auth_remember_me', '1')
    try {
      // Generate PKCE verifier/challenge manually so we always know exactly
      // what was sent to Supabase — no dependency on client internal storage.
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const verifier = btoa(String.fromCharCode(...Array.from(array)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const challenge = btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

      localStorage.setItem('__oauth_pkce_verifier', verifier)

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const params = new URLSearchParams({
        provider,
        redirect_to: 'stockshop://auth/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        flow_type: 'pkce',
      })
      const oauthUrl = `${supabaseUrl}/auth/v1/authorize?${params.toString()}`

      try {
        const { App } = await import('@capacitor/app')
        await (App as any).openUrl({ url: oauthUrl })
      } catch {
        window.location.href = oauthUrl
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur inattendue')
    }
  }

  const signInWithGoogle = async () => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    if (isNative) {
      await signInWithOAuthNative('google')
    } else {
      setError('')
      localStorage.setItem('auth_remember_me', '1')
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard` },
      })
    }
  }

  const signInWithApple = async () => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    if (isNative) {
      await signInWithOAuthNative('apple')
    } else {
      setError('')
      localStorage.setItem('auth_remember_me', '1')
      await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard` },
      })
    }
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

  const logoFilter = isDark
    ? 'brightness(0) invert(1) drop-shadow(0 6px 20px rgba(0,0,0,0.5))'
    : 'brightness(0) saturate(100%) invert(14%) sepia(90%) saturate(700%) hue-rotate(204deg) brightness(75%)'

  const inputCls = 'dark:bg-[#060e1c] dark:border-[#1b2e48] dark:text-[#d8e8ff] dark:placeholder:text-[#2e4460]'

  return (
    <div className="min-h-screen bg-[#edf2ff] dark:bg-[#040912] relative overflow-hidden">
      {/* Radial glow — dark only */}
      {isDark && (
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 55% at 50% -5%, rgba(7,62,138,0.55) 0%, transparent 70%)' }} />
      )}

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 text-gray-700 dark:text-white backdrop-blur-sm transition-colors"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="min-h-screen flex">

        {/* ── Brand panel — desktop only ── */}
        <div className="hidden lg:flex flex-col items-center justify-center flex-1 px-8 py-12 relative z-10 text-center">
          <h1 className="text-[26px] font-bold tracking-tight leading-snug text-[#0f172a] dark:text-[#e2ecff]">
            Manage smarter.<br />Sell faster.<br />Grow bigger.
          </h1>
          <p className="mt-2.5 text-[13px] leading-relaxed text-[#607090] dark:text-[#5a7098]">
            {locale === 'ha'
              ? 'Komai da kantin ku ke bukata — kaya, sayarwa, abokan ciniki da rahotanni.'
              : 'Tout ce dont votre boutique a besoin — stock, ventes, clients et rapports.'}
          </p>
          <ul className="mt-8 space-y-3">
            {[
              locale === 'ha' ? 'Yana aiki babu intanet' : 'Fonctionne hors ligne, même sans réseau',
              locale === 'ha' ? 'Kantunan da kuɗaɗe masu yawa' : 'Multi-boutiques, multi-devises',
              locale === 'ha' ? 'Rahotanni a lokaci gaskiya' : 'Rapports en temps réel',
              locale === 'ha' ? 'Hausa, Faransanci da Turanci' : 'Disponible en français, anglais et haoussa',
            ].map(f => (
              <li key={f} className="flex items-center gap-3 text-[12.5px] text-[#5570a0] dark:text-[#6880a8]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1948cc] dark:bg-[#073e8a] flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-10 text-[10.5px] tracking-wide text-[#8090b0] dark:text-[#2e4060]">
            StockShop · Made for African businesses
          </p>
        </div>

        {/* Vertical divider */}
        <div className="hidden lg:block w-px self-stretch my-10 bg-[#d0dcf0] dark:bg-[#152034]" />

        {/* ── Form side ── */}
        <div className="flex-1 flex items-center justify-center relative z-10 overflow-y-auto">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm mx-4 my-12">

            {/* Logo above card — mobile h-28, desktop h-36 */}
            <div className="flex flex-col items-center mb-6 lg:mb-8">
              <Link href={`/${locale}`} onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) e.preventDefault() }}>
                <img src="/logo-login-t.png" alt="StockShop" className="h-28 lg:h-36 w-auto object-contain" style={{ filter: logoFilter }} />
              </Link>
              <p className="text-xs mt-2 italic text-[#4a88f5] dark:text-[#4a88f5] text-[#5570a0]">
                Made for African businesses
              </p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-[#0b1525] border border-[#dce7ff] dark:border-[#152034] shadow-[0_10px_40px_rgba(7,62,138,0.10)] dark:shadow-none overflow-hidden">
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
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-[#2e4460]" />
                          <Input id="email" type="email" autoComplete="email" placeholder="admin@stockshop.ng"
                            className={`pl-9 ${inputCls}`}
                            {...loginForm.register('email')} />
                        </div>
                        {loginForm.formState.errors.email && <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="password">{t('password')}</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-[#2e4460]" />
                          <Input id="password" type={showPwd ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                            className={`pl-9 pr-10 ${inputCls}`}
                            {...loginForm.register('password')} />
                          <button type="button" onClick={() => setShowPwd(!showPwd)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground dark:text-[#2e4460] hover:text-foreground">
                            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="rounded accent-[#1948cc]" style={{ colorScheme: 'light' }} {...loginForm.register('rememberMe')} />
                          <span className="text-muted-foreground">{t('remember_me')}</span>
                        </label>
                        <button type="button" onClick={() => { setMode('forgot'); setError('') }}
                          className="text-[#073e8a] dark:text-[#4a88f5] hover:underline font-medium">
                          {t('forgot_password')}
                        </button>
                      </div>

                      {success && <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 rounded-md p-2 text-center">✓ {success}</p>}
                      {error && <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">{error}</p>}

                      <Button type="submit" className="w-full h-11 text-base bg-[#073e8a] hover:bg-[#0d52b8]"
                        style={isDark ? { background: 'linear-gradient(135deg, #1948cc 0%, #0d38a8 100%)', boxShadow: '0 4px 20px rgba(29,80,220,0.40)' } : {}}
                        loading={loginForm.formState.isSubmitting}>
                        {loginForm.formState.isSubmitting ? t('logging_in') : t('login')}
                      </Button>

                      {/* Divider */}
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex-1 h-px bg-border dark:bg-[#152034]" />
                        <span className="text-xs text-muted-foreground">{t('or_separator')}</span>
                        <div className="flex-1 h-px bg-border dark:bg-[#152034]" />
                      </div>

                      {/* OAuth */}
                      <div className="flex gap-2">
                        <button type="button" onClick={signInWithGoogle}
                          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-[#dce7ff] dark:border-[#1b2e48] bg-[#f2f6ff] dark:bg-[#090f1e] hover:bg-[#e8f0ff] dark:hover:bg-[#0c1428] text-gray-700 dark:text-[#6080a8] font-medium text-sm transition-colors">
                          <GoogleIcon /> Google
                        </button>
                        <button type="button" onClick={signInWithApple}
                          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-[#dce7ff] dark:border-[#1b2e48] bg-[#f2f6ff] dark:bg-[#090f1e] hover:bg-[#e8f0ff] dark:hover:bg-[#0c1428] text-gray-700 dark:text-[#6080a8] font-medium text-sm transition-colors">
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
                          className="mt-4 text-sm text-[#073e8a] dark:text-[#4a88f5] hover:underline">
                          {t('back_to_login')}
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={forgotForm.handleSubmit(onForgot)} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="reset-email">{t('email')}</Label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-[#2e4460]" />
                            <Input id="reset-email" type="email" placeholder="your@email.com"
                              className={`pl-9 ${inputCls}`}
                              {...forgotForm.register('email')} />
                          </div>
                        </div>

                        {error && <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">{error}</p>}

                        <Button type="submit" className="w-full h-11 bg-[#073e8a] hover:bg-[#0d52b8]"
                          style={isDark ? { background: 'linear-gradient(135deg, #1948cc 0%, #0d38a8 100%)', boxShadow: '0 4px 20px rgba(29,80,220,0.40)' } : {}}
                          loading={forgotForm.formState.isSubmitting}>
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

            <p className="text-center text-sm mt-4 text-[#607090] dark:text-[#3a5070]">
              {t('no_account')}{' '}
              <Link href={`/${locale}/register`} className="text-[#073e8a] dark:text-[#4a88f5] font-semibold hover:underline">{t('register_link')}</Link>
            </p>
          </motion.div>
        </div>

      </div>
    </div>
  )
}
