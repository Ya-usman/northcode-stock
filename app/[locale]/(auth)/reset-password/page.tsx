'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Lock, CheckCircle2, Sun, Moon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPasswordPage({ params: { locale } }: { params: { locale: string } }) {
  const router = useRouter()
  const supabase = createClient()
  const { isDark, toggle } = useTheme()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [isInvite, setIsInvite] = useState(false)

  useEffect(() => {
    // 1. PKCE flow: some Supabase project configs use ?code= instead of hash tokens
    const searchParams = new URLSearchParams(window.location.search)
    const code = searchParams.get('code')
    if (code) {
      window.history.replaceState(null, '', window.location.pathname)
      supabase.auth.exchangeCodeForSession(code)
        .then(({ data: { session }, error }) => {
          if (session && !error) {
            setIsInvite(true)
            setSessionReady(true)
          } else {
            setError('Lien invalide ou expiré. Demandez un nouveau lien de réinitialisation.')
          }
        })
      return
    }

    // 2. Implicit / OTP flow: tokens are in the URL hash (#access_token=…&type=invite)
    //    redirectTo points here directly so the hash is never lost in a server redirect.
    const hash = window.location.hash
    const params = new URLSearchParams(hash.replace('#', ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const type = params.get('type')

    if (type === 'invite') setIsInvite(true)

    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data: { session }, error }) => {
          if (session && !error) {
            setSessionReady(true)
            window.history.replaceState(null, '', window.location.pathname)
          } else {
            setError('Lien invalide ou expiré. Demandez un nouveau lien de réinitialisation.')
          }
        })
    } else {
      // 3. Existing session (e.g., forgot-password flow via /auth/callback which does PKCE
      //    exchange server-side and sets cookies before redirecting here)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true)
        } else {
          setError('Lien invalide ou expiré. Demandez un nouveau lien de réinitialisation.')
        }
      })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
      await supabase.auth.signOut()
      setDone(true)
      setTimeout(() => router.push(`/${locale}/login`), 2500)
    } catch (err: any) {
      setError(err?.message || 'Une erreur est survenue')
      setLoading(false)
    }
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

        <div className="flex flex-col items-center mb-6">
          <Link href={`/${locale}`} onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) e.preventDefault() }}>
            <img src="/logo-login-t.png" alt="StockShop" className="h-36 w-auto object-contain" style={{ filter: 'brightness(0) invert(1) drop-shadow(0 8px 24px rgba(0,0,0,0.55))' }} />
          </Link>
          <p className="text-blue-200 text-sm mt-2">Smart inventory management</p>
        </div>

        <div className="rounded-2xl bg-card dark:bg-[#0d2a5e] shadow-2xl overflow-hidden p-6">
          {done ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
              <h2 className="text-lg font-semibold">Mot de passe modifié !</h2>
              <p className="text-sm text-muted-foreground">Redirection vers la connexion…</p>
            </div>
          ) : !sessionReady ? (
            <div className="text-center py-8">
              {error ? (
                <>
                  <p className="text-sm text-destructive mb-4">{error}</p>
                  <Link href={`/${locale}/login`} className="text-sm text-stockshop-blue dark:text-blue-400 hover:underline">
                    Retour à la connexion
                  </Link>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-stockshop-blue border-t-transparent animate-spin" />
                  <p className="text-sm text-muted-foreground">Vérification du lien…</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-1">
                {isInvite ? 'Définir votre mot de passe' : 'Nouveau mot de passe'}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                {isInvite ? 'Choisissez un mot de passe pour activer votre compte' : 'Entrez et confirmez votre nouveau mot de passe'}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nouveau mot de passe</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 caractères"
                      className="pl-9 pr-10 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground dark:text-gray-500 hover:text-foreground dark:hover:text-gray-700"
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Confirmer le mot de passe</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground dark:text-gray-500" />
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="Répétez le mot de passe"
                      className="pl-9 dark:bg-white dark:text-gray-900 dark:placeholder:text-gray-400 dark:border-white/30"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-center">{error}</p>
                )}

                <Button
                  type="submit"
                  loading={loading}
                  className="w-full h-11 bg-stockshop-blue hover:bg-stockshop-blue-light text-base font-semibold"
                >
                  {isInvite ? 'Activer mon compte' : 'Enregistrer le mot de passe'}
                </Button>

                <Link
                  href={`/${locale}/login`}
                  className="block text-center text-sm text-muted-foreground hover:text-foreground"
                >
                  ← Retour à la connexion
                </Link>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
