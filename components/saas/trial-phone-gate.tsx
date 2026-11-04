'use client'

// Écran « Votre numéro de téléphone » (protection de l'essai, migration 213) : comptes créés par Google / Apple, à la
// première entrée. L'essai gratuit démarre après (POST /api/trial/phone : 1 numéro = 1 essai sur 12 mois, contrôlé
// par le serveur). Numéro déjà utilisé : le compte reste sans essai et le mur de paiement l'explique.

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Phone, LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getDeviceId } from '@/lib/device-id'

const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => m.PhoneInput), { ssr: false })

interface Props {
  shopId: string
  country?: string | null
  onDone: () => Promise<void> | void
  onSignOut: () => void
}

export function TrialPhoneGate({ shopId, country, onDone, onSignOut }: Props) {
  const t = useTranslations('trial_gate')
  const [phone, setPhone] = useState('')
  const [valid, setValid] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!phone || !valid) { setError(t(phone ? 'phone_invalid' : 'phone_required')); return }
    setBusy(true); setError(null)
    try {
      const res = await withTimeout(fetch('/api/trial/phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, phone, device_id: getDeviceId() }),
      }), 20_000)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || t('error')); return }
      await onDone()
    } catch {
      setError(t('error'))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 p-4 backdrop-blur-sm" data-testid="trial-phone-gate">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl">
        <div className="bg-gradient-to-br from-stockshop-blue to-[#1a4f9e] p-8 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
            <Phone className="h-7 w-7 text-white" />
          </div>
          <h2 className="mb-1 text-xl font-bold text-white">{t('title')}</h2>
          <p className="text-sm text-blue-100">{t('subtitle')}</p>
        </div>
        <div className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="trial-phone">{t('label')}</Label>
            <PhoneInput id="trial-phone" value={phone} defaultCountry={country} preferredCountries={[country]} invalid={!!error}
              onChange={(v, ok) => { setPhone(v); setValid(!!v && ok); setError(null) }} />
            {error
              ? <p className="text-xs text-destructive" data-testid="trial-phone-error">{error}</p>
              : <p className="text-xs text-muted-foreground">{t('hint')}</p>}
          </div>
          <Button className="h-11 w-full font-semibold" onClick={submit} loading={busy} data-testid="trial-phone-submit">{t('submit')}</Button>
          <button type="button" onClick={onSignOut} className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" />{t('sign_out')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
