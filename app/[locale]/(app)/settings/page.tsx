'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Save, Upload, Globe, Moon, Sun, ShoppingCart, History, CreditCard, Users, Package, ArrowLeftRight, Tag, Truck, BarChart2, ShieldCheck, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushPermission } from '@/lib/push'
import { useTheme } from '@/lib/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter, usePathname } from 'next/navigation'
import type { Shop } from '@/lib/types/database'
import { DEFAULT_PERMISSIONS, type AllPerms, type ConfigurableRole, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { cn } from '@/lib/utils/cn'

export default function SettingsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { shop: shopData, profile, refreshShop, patchShop, updateLocale } = useAuth()
  const supabase = createClient() as any
  const { toast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const { isDark, setIsDark } = useTheme()

  const isOwner = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'super_admin'

  const [shop, setShop] = useState<Shop | null>(shopData)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!shopData)

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

  // Push notifications
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [notifyPushNewSale, setNotifyPushNewSale] = useState(true)

  // ── Role permissions ────────────────────────────────────────────────────────
  const [activePermRole, setActivePermRole] = useState<ConfigurableRole>('cashier')
  const [permissions, setPermissions] = useState<AllPerms>(DEFAULT_PERMISSIONS)
  const [savingPerms, setSavingPerms] = useState(false)

  const PERM_FEATURES: { key: PermFeature; label: string; icon: React.ReactNode }[] = [
    { key: 'new_sale',      label: t('settings.perm_new_sale'),      icon: <ShoppingCart className="h-4 w-4" /> },
    { key: 'sales_history', label: t('settings.perm_sales_history'), icon: <History className="h-4 w-4" /> },
    { key: 'payments',      label: t('settings.perm_payments'),      icon: <CreditCard className="h-4 w-4" /> },
    { key: 'customers',     label: t('settings.perm_customers'),     icon: <Users className="h-4 w-4" /> },
    { key: 'stock',         label: t('settings.perm_stock'),         icon: <Package className="h-4 w-4" /> },
    { key: 'movements',     label: t('settings.perm_movements'),     icon: <ArrowLeftRight className="h-4 w-4" /> },
    { key: 'categories',    label: t('settings.perm_categories'),    icon: <Tag className="h-4 w-4" /> },
    { key: 'suppliers',     label: t('settings.perm_suppliers'),     icon: <Truck className="h-4 w-4" /> },
    { key: 'reports',       label: t('settings.perm_reports'),       icon: <BarChart2 className="h-4 w-4" /> },
  ]

  const ROLE_LABELS: Record<ConfigurableRole, string> = {
    manager:       t('roles.manager'),
    cashier:       t('settings.role_cashier'),
    viewer:        t('settings.role_viewer'),
    stock_manager: t('settings.role_stock_manager'),
  }

  // Initialise the form only once when shopData first loads (not on every re-render)
  // so that navigating away and back doesn't reset unsaved or just-saved values.
  const initialised = useState(false)
  useEffect(() => {
    if (shopData && !initialised[0]) {
      initialised[1](true)
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
      setNotifyPushNewSale((shopData as any).notify_push_new_sale ?? true)
      setLoading(false)
      // Load stored permissions — deep merge so partial DB objects don't lose default keys
      const stored = (shopData as any).role_permissions as Partial<AllPerms> | null
      if (stored) {
        setPermissions({
          manager:       { ...DEFAULT_PERMISSIONS.manager,       ...(stored.manager       ?? {}) },
          cashier:       { ...DEFAULT_PERMISSIONS.cashier,       ...(stored.cashier       ?? {}) },
          viewer:        { ...DEFAULT_PERMISSIONS.viewer,        ...(stored.viewer        ?? {}) },
          stock_manager: { ...DEFAULT_PERMISSIONS.stock_manager, ...(stored.stock_manager ?? {}) },
        })
      }
    }
  }, [shopData])

  // Check current push subscription state
  useEffect(() => {
    if (!isPushSupported()) return
    setPushSupported(true)
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => setPushEnabled(!!sub))
    )
  }, [])

  const togglePush = async (enabled: boolean) => {
    if (!shop?.id) return
    setPushLoading(true)
    try {
      if (enabled) {
        const ok = await subscribeToPush(shop.id)
        setPushEnabled(ok)
        if (!ok) toast({ title: t('settings.push_denied'), variant: 'destructive' })
      } else {
        await unsubscribeFromPush()
        setPushEnabled(false)
      }
    } finally {
      setPushLoading(false)
    }
  }

  const saveSettings = async () => {
    if (!shop?.id) return
    setSaving(true)
    const updates = {
      name, city, state,
      whatsapp: whatsapp || null,
      low_stock_threshold: threshold,
      tax_rate: taxRate,
      notify_whatsapp_low_stock: notifyWaLowStock,
      notify_whatsapp_daily: notifyWaDaily,
      notify_whatsapp_each_sale: notifyWaEachSale,
      notify_email_low_stock: notifyEmailLowStock,
      notify_email_daily: notifyEmailDaily,
      notify_push_new_sale: notifyPushNewSale,
    }
    const { error } = await supabase.from('shops').update(updates).eq('id', shop.id)
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    // Update local state immediately so navigating away and back doesn't reset the form
    setShop(prev => prev ? { ...prev, ...updates } : prev)
    // Sync the global auth context so the new values persist across navigation
    await refreshShop()
    toast({ title: t('settings.saved'), variant: 'success' })
  }

  const compressImage = (file: File, maxSize = 800, quality = 0.75): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Compression failed')), 'image/jpeg', quality)
      }
      img.onerror = reject
      img.src = url
    })

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !shop?.id) return
    setUploadingLogo(true)
    try {
      // Compress before upload (max 800px, JPEG 75%)
      const compressed = await compressImage(file)
      // Always use .jpg so the same path is overwritten each time
      const path = `${shop.id}/logo.jpg`
      const { error: uploadError } = await supabase.storage
        .from('shop-logos')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      // Add timestamp to bust CDN cache
      const { data: { publicUrl } } = supabase.storage.from('shop-logos').getPublicUrl(path)
      const urlWithBust = `${publicUrl}?t=${Date.now()}`

      await supabase.from('shops').update({ logo_url: urlWithBust }).eq('id', shop.id)

      // Update local state immediately so the image shows right away
      setShop(prev => prev ? { ...prev, logo_url: urlWithBust } : prev)
      // Also refresh the global auth context
      await refreshShop()

      toast({ title: t('toast.logo_updated'), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setUploadingLogo(false)
      // Reset input so the same file can be re-selected
      e.target.value = ''
    }
  }

  const togglePermission = async (role: ConfigurableRole, feature: PermFeature, value: boolean) => {
    if (!shop?.id) return
    const prev = permissions
    const updated: AllPerms = {
      ...permissions,
      [role]: { ...permissions[role], [feature]: value },
    }
    setPermissions(updated)
    setSavingPerms(true)
    try {
      const res = await fetch('/api/team/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, role_permissions: updated }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur inconnue')
      // Update auth context directly — avoids stale-read from DB replica after write
      patchShop(shop.id, { role_permissions: updated })
      toast({ title: t('settings.perms_saved'), description: t('settings.perms_saved_desc'), variant: 'success' })
    } catch (err: any) {
      toast({ title: t('settings.perms_error'), description: err.message, variant: 'destructive' })
      setPermissions(prev)
    } finally {
      setSavingPerms(false)
    }
  }

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    updateLocale(newLocale)
    window.location.href = newPath
  }

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>

  return (
    <div className="space-y-4 max-w-2xl">

      {/* Owner-only sections: shop info, business settings, notifications */}
      {isOwner && (
        <>
          {/* Shop Info */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t('settings.shop_info')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl overflow-hidden border bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center flex-shrink-0">
                  {shop?.logo_url ? (
                    <img src={shop.logo_url} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-stockshop-blue dark:text-blue-400 font-bold text-xl">NC</span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{t('settings.logo')}</p>
                  <label className="mt-1 inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                    <Upload className="h-3 w-3" />
                    {uploadingLogo ? t('settings.uploading') : t('settings.upload_logo')}
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
              <CardTitle className="text-sm font-semibold">{t('settings.business')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t('settings.low_stock_threshold')}</Label>
                  <Input type="number" min={1} value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">{t('settings.stock_alert_hint')}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.tax_rate')}</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} step={0.5} value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className="pr-8" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('settings.tax_hint')}</p>
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
              <p className="text-xs text-muted-foreground">{t('settings.notif_hint')}</p>
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

              {pushSupported && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      {t('settings.push_notifications')}
                    </p>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="cursor-pointer">{t('settings.push_low_stock')}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {pushEnabled ? t('settings.push_enabled') : t('settings.push_disabled')}
                        </p>
                      </div>
                      <Switch
                        checked={pushEnabled}
                        onCheckedChange={togglePush}
                        disabled={pushLoading}
                      />
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="cursor-pointer">Alerte nouvelle vente</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Recevoir son + vibration quand un caissier fait une vente
                        </p>
                      </div>
                      <Switch
                        checked={notifyPushNewSale}
                        onCheckedChange={setNotifyPushNewSale}
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Appearance — Dark Mode */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {t('settings.appearance')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('settings.dark_mode')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('settings.dark_mode_desc')}</p>
            </div>
            <Switch checked={isDark} onCheckedChange={setIsDark} />
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
              { code: 'fr', label: '🇫🇷 Français' },
              { code: 'ha', label: '🇳🇬 Hausa' },
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => switchLanguage(lang.code)}
                className={`rounded-lg border p-3 text-sm font-medium transition-colors tap-target ${
                  locale === lang.code
                    ? 'border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Role Permissions — owner only */}
      {isOwner && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-stockshop-blue" />
              {t('settings.role_permissions')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t('settings.role_permissions_desc')}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Role tabs */}
            <div className="flex gap-2 flex-wrap">
              {(['manager', 'cashier', 'viewer', 'stock_manager'] as ConfigurableRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setActivePermRole(r)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border',
                    activePermRole === r
                      ? 'bg-stockshop-blue text-white border-stockshop-blue'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
              {savingPerms && <span className="text-xs text-muted-foreground self-center ml-1">{t('settings.saving_perms')}</span>}
            </div>

            {/* Feature toggles */}
            <div className="space-y-1">
              {PERM_FEATURES.map(({ key, label, icon }) => (
                <div key={key} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="text-muted-foreground">{icon}</span>
                    <span>{label}</span>
                  </div>
                  <Switch
                    checked={permissions[activePermRole][key]}
                    onCheckedChange={val => togglePermission(activePermRole, key, val)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save button — owner only */}
      {isOwner && (
        <Button
          onClick={saveSettings}
          loading={saving}
          className="w-full h-12 bg-stockshop-blue hover:bg-stockshop-blue-light"
          size="lg"
        >
          <Save className="mr-2 h-4 w-4" />
          {t('actions.save')}
        </Button>
      )}
    </div>
  )
}
