'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Store, User, Phone, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'

const schema = z.object({
  full_name: z.string().min(2, 'Nom requis'),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  shop_name: z.string().min(2, 'Nom de boutique requis'),
  city: z.string().min(2, 'Ville requise'),
  phone: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export default function RegisterPage({ params: { locale } }: { params: { locale: string } }) {
  const router = useRouter()
  const supabase = createClient()
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [country, setCountry] = useState<CountryCode | null>(null)

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
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { full_name: data.full_name } },
      })
      if (signUpError) throw signUpError
      if (!authData.user) throw new Error('Erreur création compte')

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        throw new Error(err.error || 'Erreur serveur')
      }

      document.cookie = `user_role=owner; path=/; max-age=3600`
      router.push(`/${locale}/dashboard`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const selectedCountry = country ? COUNTRIES[country] : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-northcode-blue via-northcode-blue-light to-blue-800 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="StockShop" className="h-12 w-auto mx-auto mb-3 brightness-0 invert" />
          <h1 className="text-2xl font-bold text-white">Créer votre boutique</h1>
          <p className="text-blue-200 text-sm mt-1">7 jours gratuits · Sans carte bancaire</p>
        </div>

        <div className="rounded-2xl bg-white shadow-2xl p-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 1 ? 'bg-northcode-blue' : 'bg-gray-200'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 2 ? 'bg-northcode-blue' : 'bg-gray-200'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors ${step >= 3 ? 'bg-northcode-blue' : 'bg-gray-200'}`} />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* Step 1 — Compte */}
            {step === 1 && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <h2 className="font-semibold text-lg">Votre compte</h2>

                <div className="space-y-1.5">
                  <Label>Nom complet</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('full_name')} placeholder="Malam Usman" className="pl-9" />
                  </div>
                  {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input {...register('email')} type="email" placeholder="vous@email.com" />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Mot de passe</Label>
                  <div className="relative">
                    <Input
                      {...register('password')}
                      type={showPwd ? 'text' : 'password'}
                      placeholder="Minimum 8 caractères"
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
                  Suivant →
                </Button>
              </motion.div>
            )}

            {/* Step 2 — Pays */}
            {step === 2 && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div>
                  <h2 className="font-semibold text-lg">Votre pays</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Détermine la devise et le mode de paiement pour votre abonnement</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(Object.values(COUNTRIES)).map(c => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setCountry(c.code)}
                      className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                        country === c.code
                          ? 'border-northcode-blue bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-4xl">{c.flag}</span>
                      <div className="text-center">
                        <p className="font-semibold text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.currencySymbol}</p>
                      </div>
                      {country === c.code && (
                        <div className="h-2 w-2 rounded-full bg-northcode-blue" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">← Retour</Button>
                  <Button type="button" onClick={goStep3} disabled={!country} className="flex-1 bg-northcode-blue">
                    Suivant →
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3 — Boutique */}
            {step === 3 && selectedCountry && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-lg">Votre boutique</h2>
                  <span className="text-lg">{selectedCountry.flag}</span>
                </div>

                <div className="space-y-1.5">
                  <Label>Nom de la boutique</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('shop_name')} placeholder="Boutique Alhaji Musa" className="pl-9" />
                  </div>
                  {errors.shop_name && <p className="text-xs text-destructive">{errors.shop_name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Ville</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input {...register('city')} placeholder={selectedCountry.cityPlaceholder} className="pl-9" />
                  </div>
                  {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Téléphone <span className="text-muted-foreground text-xs">(optionnel)</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">{selectedCountry.phonePrefix}</span>
                    <Input {...register('phone')} placeholder="XXXXXXXXXX" className="pl-14" />
                  </div>
                </div>

                {error && <p className="text-sm text-destructive bg-red-50 rounded-md p-2 text-center">{error}</p>}

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1">← Retour</Button>
                  <Button type="submit" loading={isSubmitting} className="flex-1 bg-northcode-blue">
                    Créer ma boutique
                  </Button>
                </div>
              </motion.div>
            )}
          </form>
        </div>

        <p className="text-center text-blue-200 text-sm mt-4">
          Déjà un compte ?{' '}
          <Link href={`/${locale}/login`} className="text-white font-medium hover:underline">
            Se connecter
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
