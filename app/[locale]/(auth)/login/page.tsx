'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

export default function LoginPage({ params: { locale }, searchParams }: { params: { locale: string }, searchParams: { error?: string } }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const supabase = createClient()
  const [showPwd, setShowPwd] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [error, setError] = useState(
    searchParams?.error === 'no_profile' ? 'Account not configured yet. Contact your administrator.' :
    searchParams?.error === 'inactive' ? 'Your account has been deactivated. Contact your administrator.' :
    ''
  )
  const [success, setSuccess] = useState('')

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  })
  const forgotForm = useForm<ForgotData>({ resolver: zodResolver(forgotSchema) })

  const onLogin = async (data: LoginData) => {
    setError('')
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    if (error) {
      setError(t('invalid_credentials'))
      return
    }
    // Cache role in cookie to avoid DB call on every middleware request
    if (authData.user) {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .single()
      const role = (data as { role: string } | null)?.role
      if (role) {
        document.cookie = `user_role=${role}; path=/; max-age=3600`
      }
    }
    // Redirect to the user's preferred locale (saved in cookie), fallback to current
    const preferredLocale = document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] || locale
    router.push(`/${preferredLocale}/dashboard`)
    router.refresh()
  }

  const onForgot = async (data: ForgotData) => {
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/en/reset-password`,
    })
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(t('reset_sent'))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-northcode-blue via-northcode-blue-light to-blue-800 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-northcode-blue font-bold text-2xl shadow-lg mb-4">
            NC
          </div>
          <h1 className="text-2xl font-bold text-white">NorthCode Stock</h1>
          <p className="text-blue-200 text-sm mt-1">
            {locale === 'ha' ? 'Lissafin kaya mai wayo' : 'Smart inventory management'}
          </p>
        </div>

        <div className="rounded-2xl bg-white shadow-2xl overflow-hidden">
          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="p-6"
              >
                <h2 className="text-xl font-semibold mb-1">{t('welcome_back')}</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  {locale === 'ha' ? 'Shigar da imelinka da kalmar sirri' : 'Sign in to your account'}
                </p>

                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{t('email')}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="admin@northcode.ng"
                        className="pl-9"
                        {...loginForm.register('email')}
                      />
                    </div>
                    {loginForm.formState.errors.email && (
                      <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password">{t('password')}</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPwd ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className="pl-9 pr-10"
                        {...loginForm.register('password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(!showPwd)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        {...loginForm.register('rememberMe')}
                      />
                      <span className="text-muted-foreground">{t('remember_me')}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError('') }}
                      className="text-northcode-blue hover:underline font-medium"
                    >
                      {t('forgot_password')}
                    </button>
                  </div>

                  {error && (
                    <p className="text-sm text-destructive bg-red-50 rounded-md p-2 text-center">{error}</p>
                  )}

                  <Button
                    type="submit"
                    className="w-full bg-northcode-blue hover:bg-northcode-blue-light h-12 text-base"
                    loading={loginForm.formState.isSubmitting}
                  >
                    {loginForm.formState.isSubmitting ? t('logging_in') : t('login')}
                  </Button>
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="forgot"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-6"
              >
                <h2 className="text-xl font-semibold mb-1">{t('forgot_password')}</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  {locale === 'ha' ? 'Shigar da imelinka don sake saita kalmar sirri' : 'Enter your email to reset your password'}
                </p>

                {success ? (
                  <div className="text-center py-4">
                    <div className="text-5xl mb-3">📧</div>
                    <p className="text-sm text-green-700 bg-green-50 rounded-md p-3">{success}</p>
                    <button
                      onClick={() => { setMode('login'); setSuccess(''); forgotForm.reset() }}
                      className="mt-4 text-sm text-northcode-blue hover:underline"
                    >
                      {t('back_to_login')}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={forgotForm.handleSubmit(onForgot)} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="reset-email">{t('email')}</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reset-email"
                          type="email"
                          className="pl-9"
                          placeholder="your@email.com"
                          {...forgotForm.register('email')}
                        />
                      </div>
                    </div>

                    {error && (
                      <p className="text-sm text-destructive bg-red-50 rounded-md p-2 text-center">{error}</p>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-northcode-blue hover:bg-northcode-blue-light h-12"
                      loading={forgotForm.formState.isSubmitting}
                    >
                      {t('send_reset_link')}
                    </Button>

                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError('') }}
                      className="block w-full text-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      ← {t('back_to_login')}
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-blue-200 text-xs mt-6">
          NorthCode Stock Manager · Built for Northern Nigeria
        </p>
      </motion.div>
    </div>
  )
}
