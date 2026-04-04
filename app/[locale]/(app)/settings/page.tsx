'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Save, Upload, Globe } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/use-auth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter, usePathname } from 'next/navigation'
import type { Shop } from '@/lib/types/database'

export default function SettingsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { shop: shopData, profile } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()
  const router = useRouter()
  const pathname = usePathname()

  const [shop, setShop] = useState<Shop | null>(shopData)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!shopData)

  // Form state
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [threshold, setThreshold] = useState(10)
  const [taxRate, setTaxRate] = useState(0)
  const [notifyWaLowStock, setNotifyWaLowStock] = useState(true)
  const [notifyWaDaily, setNotifyWaDaily] = useState(true)
  const [notifyWaEachSale, setNotifyWaEachSale] = useState(false)
  const [notifyEmailLowStock, setNotifyEmailLowStock] = useState(true)
  const [notifyEmailDaily, setNotifyEmailDaily] = useState(true)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  useEffect(() => {
    if (shopData) {
      setShop(shopData)
      setName(shopData.name)
      setCity(shopData.city)
      setState(shopData.state)
      setWhatsapp(shopData.whatsapp || '')
      setThreshold(shopData.low_stock_threshold)
      setTaxRate(shopData.tax_rate)
      setNotifyWaLowStock(shopData.notify_whatsapp_low_stock)
      setNotifyWaDaily(shopData.notify_whatsapp_daily)
      setNotifyWaEachSale(shopData.notify_whatsapp_each_sale)
      setNotifyEmailLowStock(shopData.notify_email_low_stock)
      setNotifyEmailDaily(shopData.notify_email_daily)
      setLoading(false)
    }
  }, [shopData])

  const saveSettings = async () => {
    if (!shop?.id) return
    setSaving(true)
    const { error } = await supabase.from('shops').update({
      name, city, state,
      whatsapp: whatsapp || null,
      low_stock_threshold: threshold,
      tax_rate: taxRate,
      notify_whatsapp_low_stock: notifyWaLowStock,
      notify_whatsapp_daily: notifyWaDaily,
      notify_whatsapp_each_sale: notifyWaEachSale,
      notify_email_low_stock: notifyEmailLowStock,
      notify_email_daily: notifyEmailDaily,
    }).eq('id', shop.id)
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: t('settings.saved'), variant: 'success' })
  }

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !shop?.id) return
    setUploadingLogo(true)
    const ext = file.name.split('.').pop()
    const path = `${shop.id}/logo.${ext}`
    const { error: uploadError } = await supabase.storage.from('shop-logos').upload(path, file, { upsert: true })
    if (uploadError) { toast({ title: uploadError.message, variant: 'destructive' }); setUploadingLogo(false); return }
    const { data: { publicUrl } } = supabase.storage.from('shop-logos').getPublicUrl(path)
    await supabase.from('shops').update({ logo_url: publicUrl }).eq('id', shop.id)
    setUploadingLogo(false)
    toast({ title: 'Logo updated!', variant: 'success' })
  }

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    localStorage.setItem('NEXT_LOCALE', newLocale)
    router.push(newPath)
  }

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Shop Info */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Shop Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl overflow-hidden border bg-northcode-blue-muted flex items-center justify-center flex-shrink-0">
              {shop?.logo_url ? (
                <img src={shop.logo_url} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-northcode-blue font-bold text-xl">NC</span>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{t('settings.logo')}</p>
              <label className="mt-1 inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                <Upload className="h-3 w-3" />
                {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
                <input type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t('settings.shop_name')} *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Boutique Alpha" />
            </div>
            <div className="space-y-1">
              <Label>{t('settings.whatsapp')}</Label>
              <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="2348012345678" type="tel" />
            </div>
            <div className="space-y-1">
              <Label>{t('settings.city')}</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Kano" />
            </div>
            <div className="space-y-1">
              <Label>{t('settings.state')}</Label>
              <Input value={state} onChange={e => setState(e.target.value)} placeholder="Kano State" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Business Settings */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Business Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t('settings.low_stock_threshold')}</Label>
              <Input type="number" min={1} value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">Alert when stock reaches this level</p>
            </div>
            <div className="space-y-1">
              <Label>{t('settings.tax_rate')}</Label>
              <div className="relative">
                <Input type="number" min={0} max={100} step={0.5} value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className="pr-8" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">0 = no tax applied</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">{t('settings.notifications')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Configure alerts sent to your phone and email</p>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">WhatsApp</p>
            {[
              { label: t('settings.alert_low_stock'), value: notifyWaLowStock, setter: setNotifyWaLowStock },
              { label: t('settings.alert_daily'), value: notifyWaDaily, setter: setNotifyWaDaily },
              { label: t('settings.alert_each_sale'), value: notifyWaEachSale, setter: setNotifyWaEachSale },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-1">
                <Label className="cursor-pointer">{item.label}</Label>
                <Switch checked={item.value} onCheckedChange={item.setter} />
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</p>
            {[
              { label: t('settings.alert_low_stock'), value: notifyEmailLowStock, setter: setNotifyEmailLowStock },
              { label: t('settings.alert_daily'), value: notifyEmailDaily, setter: setNotifyEmailDaily },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-1">
                <Label className="cursor-pointer">{item.label}</Label>
                <Switch checked={item.value} onCheckedChange={item.setter} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t('settings.language')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {[
              { code: 'en', label: '🇬🇧 English' },
              { code: 'ha', label: '🇳🇬 Hausa' },
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => switchLanguage(lang.code)}
                className={`rounded-lg border p-3 text-sm font-medium transition-colors tap-target ${
                  locale === lang.code
                    ? 'border-northcode-blue bg-northcode-blue-muted text-northcode-blue'
                    : 'border-input bg-white text-muted-foreground hover:bg-muted'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <Button
        onClick={saveSettings}
        loading={saving}
        className="w-full h-12 bg-northcode-blue hover:bg-northcode-blue-light"
        size="lg"
      >
        <Save className="mr-2 h-4 w-4" />
        {t('actions.save')}
      </Button>
    </div>
  )
}
