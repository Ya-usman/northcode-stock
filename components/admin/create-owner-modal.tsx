'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, UserPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { COUNTRIES } from '@/lib/saas/countries'

const COUNTRY_OPTIONS = Object.values(COUNTRIES).map(c => ({
  code: c.code,
  label: `${c.flag} ${c.name}`,
  currency: c.currencySymbol,
}))

export function CreateOwnerModal() {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    shop_name: '',
    city: '',
    country: 'NG',
  })

  const selectedCountry = COUNTRIES[form.country as keyof typeof COUNTRIES] || COUNTRIES.NG

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const reset = () => {
    setForm({ full_name: '', email: '', shop_name: '', city: '', country: 'NG' })
    setOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.full_name || !form.shop_name) return

    setLoading(true)
    try {
      const res = await fetch('/api/admin/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          shop_name: form.shop_name.trim(),
          city: form.city.trim() || null,
          country: form.country,
          currency: selectedCountry.currencySymbol,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: `✅ Compte créé — invitation envoyée à ${form.email}`, variant: 'success' })
      reset()
      router.refresh()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary'

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-2 h-8">
        <Plus className="h-3.5 w-3.5" />
        Nouveau propriétaire
      </Button>

      <Dialog open={open} onOpenChange={v => { if (!v) reset(); else setOpen(true) }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <UserPlus className="h-4 w-4" />
              Créer un propriétaire
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Nom complet *</label>
                <input
                  required
                  value={form.full_name}
                  onChange={set('full_name')}
                  placeholder="DIALLO Moussa"
                  className={inputCls}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="moussa@boutique.com"
                  className={inputCls}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Nom de la boutique *</label>
                <input
                  required
                  value={form.shop_name}
                  onChange={set('shop_name')}
                  placeholder="Boutique Excellence"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Pays</label>
                <select
                  value={form.country}
                  onChange={set('country')}
                  className={inputCls}
                >
                  {COUNTRY_OPTIONS.map(c => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ville</label>
                <input
                  value={form.city}
                  onChange={set('city')}
                  placeholder={selectedCountry.cityPlaceholder}
                  className={inputCls}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
              Un email d'invitation sera envoyé à <strong>{form.email || '…'}</strong>.
              Le compte démarrera avec 14 jours d'essai. Devise : <strong>{selectedCountry.currencySymbol}</strong>.
            </p>

            <DialogFooter className="gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={reset} className="border-border">
                Annuler
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={loading || !form.email || !form.full_name || !form.shop_name}
                className="gap-2"
              >
                {loading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Création…</>
                  : <><UserPlus className="h-3.5 w-3.5" />Créer et inviter</>
                }
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
