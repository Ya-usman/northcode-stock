'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Lock, CheckCircle2, Loader2 } from 'lucide-react'

export default function ResetPasswordPage({ params: { locale } }: { params: { locale: string } }) {
  const router = useRouter()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [isInvite, setIsInvite] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    const params = new URLSearchParams(hash.replace('#', ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const type = params.get('type')

    if (type === 'invite') setIsInvite(true)

    if (accessToken && refreshToken) {
      // Manually set session from hash tokens (event may have already fired)
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data: { session }, error }) => {
          if (session && !error) {
            setSessionReady(true)
            // Clean the hash from the URL without reloading
            window.history.replaceState(null, '', window.location.pathname)
          } else {
            setError('Lien invalide ou expiré. Demandez une nouvelle invitation.')
          }
        })
    } else {
      // No hash tokens — check if session already exists (e.g. page reload)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true)
        } else {
          setError('Lien invalide ou expiré. Demandez une nouvelle invitation.')
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
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setDone(true)
    setTimeout(() => router.push(`/${locale}/dashboard`), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-northcode-blue via-northcode-blue-light to-blue-800 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-card text-northcode-blue dark:text-blue-400 font-bold text-2xl shadow-lg mb-4">
            NC
          </div>
          <h1 className="text-2xl font-bold text-white">StockShop</h1>
        </div>

        <div className="rounded-2xl bg-card shadow-2xl p-6">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold mb-1">Mot de passe défini !</h2>
              <p className="text-sm text-muted-foreground">Redirection vers le dashboard…</p>
            </div>
          ) : !sessionReady ? (
            <div className="text-center py-8">
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 text-northcode-blue dark:text-blue-400 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Vérification du lien…</p>
                </>
              )}
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-1">
                {isInvite ? 'Définir votre mot de passe' : 'Nouveau mot de passe'}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {isInvite
                  ? 'Choisissez un mot de passe pour activer votre compte'
                  : 'Entrez votre nouveau mot de passe'}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Mot de passe</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 caractères"
                      className="pl-9 pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Confirmer le mot de passe</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="Répétez le mot de passe"
                      className="pl-9"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                )}

                <Button
                  type="submit"
                  loading={loading}
                  className="w-full h-11 bg-northcode-blue hover:bg-northcode-blue-light font-semibold"
                >
                  {isInvite ? 'Activer mon compte' : 'Enregistrer le mot de passe'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
