'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Save, Upload, Globe, Moon, Sun, ShoppingCart, History, CreditCard, Users, Package, ArrowLeftRight, Tag, Truck, BarChart2, ShieldCheck, Bell, Receipt, NotebookPen, Trash2, ClipboardList, ClipboardCheck, TrendingUp, AlertTriangle, CalendarDays, Clock, Gift, ChevronRight, Printer, Bluetooth, Percent } from 'lucide-react'
import { readTicketSettings, writeTicketSettings, DEFAULT_TICKET_SETTINGS, type TicketPrintSettings } from '@/lib/receipt/print-settings'
import { printSaleTicket, ticketErrorKey } from '@/lib/receipt/print-ticket'
import { BluetoothPrinter, BLUETOOTH_IMAGING_CLASS, type PairedDevice } from '@/lib/receipt/bluetooth-printer'
import { isCapacitor as isNativeApp } from '@/lib/utils/native-share'
import { ticketLabelsFromT } from '@/lib/receipt/ticket'
import { receiptBaseUrl } from '@/lib/receipt/receipt-link'
import { prepareLogo } from '@/lib/utils/logo-image'
import { ShopLogo } from '@/components/shop/shop-logo'
import { hideStockShopBranding } from '@/lib/receipt/branding'
import { formatCurrency as fmtCurrency } from '@/lib/utils/currency'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { CountrySelect } from '@/components/ui/country-select'
import { resolveCurrencyCode, currencySymbol } from '@/lib/saas/currencies'
import { useToast } from '@/components/ui/use-toast'
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushPermission } from '@/lib/push'
import { useTheme } from '@/lib/hooks/use-theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter, usePathname } from 'next/navigation'
import type { Shop } from '@/lib/types/database'
import { DEFAULT_PERMISSIONS, DEFAULT_GENERAL, type AllPerms, type ConfigurableRole, type PermFeature, type RolePerms } from '@/lib/hooks/use-role-permissions'
import { isLevelFeature, isViewerLocked, levelOf, mergeRolePerms, withLevel, type Level, type LevelFeature, type StoredPermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils/cn'
import { CompanyCard } from '@/components/settings/company-card'
import { withTimeout } from '@/lib/utils/with-timeout'

export default function SettingsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { shop: shopData, profile, refreshShop, patchShop, updateLocale, roleInActiveShop } = useAuth()
  const supabase = createClient() as any
  const { toast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const { isDark, setIsDark } = useTheme()

  const isOwner = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'shop_manager' || profile?.role === 'super_admin'
  // Plus étroit que isOwner ci-dessus (qui inclut manager/shop_manager) —
  // aligné sur la vérification réelle de /api/shops/settings, pour ne pas
  // afficher une carte qu'un manager pourrait remplir mais jamais enregistrer.
  const canManageHours = profile?.role === 'owner' || profile?.role === 'super_admin'
  // Accès par rôle : réservé au PROPRIÉTAIRE de la boutique (décision du 5 oct.
  // 2026, même règle que /api/team/permissions) — un Manager ou un Responsable
  // ne modifie jamais les droits, pas même ceux de son propre rôle.
  const canEditPermissions = roleInActiveShop === 'owner' || roleInActiveShop === 'super_admin'

  const [shop, setShop] = useState<Shop | null>(shopData)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!shopData)

  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [country, setCountry] = useState<CountryCode>('NG')
  const [currency, setCurrency] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  // Identité imprimée sur les reçus et tickets (migration 149)
  const [receiptTagline, setReceiptTagline] = useState('')
  const [receiptLegalIds, setReceiptLegalIds] = useState('')
  const [receiptFooter, setReceiptFooter] = useState('')
  const [threshold, setThreshold] = useState<string>('10')
  const [taxRate, setTaxRate] = useState<string>('0')
  const [expiryAlertDays, setExpiryAlertDays] = useState<string>('14')
  const [defaultCreditTermDays, setDefaultCreditTermDays] = useState<string>('30')

  const [hoursEnabled, setHoursEnabled] = useState(false)
  const [openingTime, setOpeningTime] = useState('08:00')
  const [closingTime, setClosingTime] = useState('20:00')
  const [hoursOverride, setHoursOverride] = useState<'auto' | 'open' | 'closed'>('auto')

  const [notifyEmailLowStock, setNotifyEmailLowStock] = useState(true)
  const [notifyEmailDaily, setNotifyEmailDaily] = useState(true)
  const [notifyEmailExpiry, setNotifyEmailExpiry] = useState(true)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  // Push notifications
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [testingPush, setTestingPush] = useState(false)
  const [notifyPushNewSale, setNotifyPushNewSale] = useState(true)
  const [notifyPushNewExpense, setNotifyPushNewExpense] = useState(true)
  const [notifyPushExpiry, setNotifyPushExpiry] = useState(true)
  const [saleSoundEnabled, setSaleSoundEnabled] = useState(true)
  const [saleVibrationEnabled, setSaleVibrationEnabled] = useState(true)

  // Read from localStorage after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    setSaleSoundEnabled(localStorage.getItem('sale_sound_enabled') !== '0')
    setSaleVibrationEnabled(localStorage.getItem('sale_vibration_enabled') !== '0')
  }, [])

  // ── Impression des tickets — réglages PAR APPAREIL (lus après montage, comme les sons)
  const [ticket, setTicket] = useState<TicketPrintSettings>(DEFAULT_TICKET_SETTINGS)
  const [testPrinting, setTestPrinting] = useState(false)
  // App Android (Capacitor) : seule plateforme où le plugin Bluetooth existe —
  // lu après montage pour ne pas diverger du rendu serveur.
  const [nativeApp, setNativeApp] = useState(false)
  const [btDevices, setBtDevices] = useState<PairedDevice[] | null>(null)
  const [btLoading, setBtLoading] = useState(false)
  useEffect(() => { setTicket(readTicketSettings()); setNativeApp(isNativeApp()) }, [])
  const updateTicket = (patch: Partial<TicketPrintSettings>) => {
    const next = { ...ticket, ...patch }
    setTicket(next)
    writeTicketSettings(next)
  }
  const loadPairedDevices = async () => {
    setBtLoading(true)
    try {
      const { devices } = await BluetoothPrinter.listPaired()
      // Imprimantes (classe IMAGING) d'abord, puis le reste, par nom
      const rank = (d: PairedDevice) => (d.majorClass === BLUETOOTH_IMAGING_CLASS ? 0 : 1)
      setBtDevices([...devices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)))
    } catch (e: any) {
      setBtDevices(null)
      toast({ title: t(ticketErrorKey(e)), variant: 'destructive' })
    } finally {
      setBtLoading(false)
    }
  }
  const choosePrinter = (d: PairedDevice) => {
    updateTicket({ bluetoothAddress: d.address, bluetoothName: d.name })
    setBtDevices(null)
  }
  const printTestTicket = async () => {
    setTestPrinting(true)
    try {
      const code = shop?.currency || 'XAF'
      const item = t('settings.ticket_test_item')
      await printSaleTicket({
        settings: ticket,
        fileName: 'Ticket-test.pdf',
        logoUrl: shop?.logo_url,
        data: {
          shop: { name: shop?.name || 'StockShop', city: shop?.city, state: shop?.state, whatsapp: shop?.whatsapp, tagline: shop?.receipt_tagline, legalIds: shop?.receipt_legal_ids },
          footerMessage: shop?.receipt_footer,
          // Ticket test : le QR mène à l'accueil du site (pas de vente derrière)
          receiptUrl: receiptBaseUrl(),
          saleNumber: 'TEST',
          createdAt: new Date(),
          items: [{ name: `${item} 1`, qty: 2, unitPrice: 500, subtotal: 1000 }, { name: `${item} 2`, qty: 1, unitPrice: 1500, subtotal: 1500 }],
          subtotal: 2500, discount: 0, tax: 0, total: 2500, amountPaid: 2500, balance: 0,
          paymentLabel: t('receipt.method_cash'),
          cashReceived: 3000, change: 500,
          cashierName: profile?.full_name || '',
          locale,
          fmt: n => fmtCurrency(n, code),
          fmtShort: n => Math.round(n).toLocaleString(locale),
          labels: ticketLabelsFromT(t),
          hideBranding: hideStockShopBranding(shop),
        },
      })
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast({ title: t(ticketErrorKey(e)), description: e?.message, variant: 'destructive' })
    } finally {
      setTestPrinting(false)
    }
  }

  // ── Role permissions ────────────────────────────────────────────────────────
  const [activePermRole, setActivePermRole] = useState<ConfigurableRole | 'general'>('cashier')
  const [permissions, setPermissions] = useState<AllPerms>(DEFAULT_PERMISSIONS)
  const [generalPerms, setGeneralPerms] = useState<Record<PermFeature, boolean>>(DEFAULT_GENERAL)
  const [savingPerms, setSavingPerms] = useState(false)

  const PERM_FEATURES: { key: PermFeature; label: string; icon: React.ReactNode }[] = [
    { key: 'new_sale',      label: t('settings.perm_new_sale'),      icon: <ShoppingCart className="h-4 w-4" /> },
    { key: 'discount',      label: t('settings.perm_discount'),      icon: <Percent className="h-4 w-4" /> },
    { key: 'sales_history', label: t('settings.perm_sales_history'), icon: <History className="h-4 w-4" /> },
    { key: 'payments',      label: t('settings.perm_payments'),      icon: <CreditCard className="h-4 w-4" /> },
    { key: 'customers',     label: t('settings.perm_customers'),     icon: <Users className="h-4 w-4" /> },
    { key: 'stock',         label: t('settings.perm_stock'),         icon: <Package className="h-4 w-4" /> },
    { key: 'movements',     label: t('settings.perm_movements'),     icon: <ArrowLeftRight className="h-4 w-4" /> },
    { key: 'categories',    label: t('settings.perm_categories'),    icon: <Tag className="h-4 w-4" /> },
    { key: 'suppliers',     label: t('settings.perm_suppliers'),     icon: <Truck className="h-4 w-4" /> },
    { key: 'inventory_count', label: t('settings.perm_inventory_count'), icon: <ClipboardCheck className="h-4 w-4" /> },
    { key: 'reports',        label: t('settings.perm_reports'),        icon: <BarChart2 className="h-4 w-4" /> },
    { key: 'expenses',       label: t('settings.perm_expenses'),       icon: <Receipt className="h-4 w-4" /> },
    { key: 'notes',          label: t('settings.perm_notes'),          icon: <NotebookPen className="h-4 w-4" /> },
    { key: 'revenue_chart',   label: t('settings.perm_revenue_chart'),   icon: <ShieldCheck className="h-4 w-4" /> },
    { key: 'delete_products', label: t('settings.perm_delete_products'), icon: <Trash2 className="h-4 w-4" /> },
    { key: 'delete_expenses', label: t('settings.perm_delete_expenses'), icon: <Trash2 className="h-4 w-4" /> },
    { key: 'caisse',          label: t('settings.perm_caisse'),          icon: <ClipboardList className="h-4 w-4" /> },
    { key: 'extend_hours',    label: t('settings.perm_extend_hours'),    icon: <Clock className="h-4 w-4" /> },
  ]

  const DASHBOARD_WIDGET_FEATURES: { key: PermFeature; label: string; icon: React.ReactNode }[] = [
    { key: 'widget_today_revenue',          label: t('settings.perm_widget_today_revenue'),          icon: <TrendingUp className="h-4 w-4" /> },
    { key: 'widget_sales_count',            label: t('settings.perm_widget_sales_count'),            icon: <ShoppingCart className="h-4 w-4" /> },
    { key: 'widget_stock_alerts_card',       label: t('settings.perm_widget_stock_alerts_card'),       icon: <AlertTriangle className="h-4 w-4" /> },
    { key: 'widget_outstanding_debt',        label: t('settings.perm_widget_outstanding_debt'),        icon: <CreditCard className="h-4 w-4" /> },
    { key: 'widget_net_result',              label: t('settings.perm_widget_net_result'),              icon: <CalendarDays className="h-4 w-4" /> },
    { key: 'widget_stock_alerts_list',       label: t('settings.perm_widget_stock_alerts_list'),       icon: <Package className="h-4 w-4" /> },
    { key: 'widget_dashboard_revenue_chart', label: t('settings.perm_widget_dashboard_revenue_chart'), icon: <BarChart2 className="h-4 w-4" /> },
    { key: 'widget_top_products_chart',      label: t('settings.perm_widget_top_products_chart'),      icon: <BarChart2 className="h-4 w-4" /> },
    { key: 'widget_recent_sales',            label: t('settings.perm_widget_recent_sales'),            icon: <History className="h-4 w-4" /> },
  ]

  const REPORT_WIDGET_FEATURES: { key: PermFeature; label: string; icon: React.ReactNode }[] = [
    { key: 'widget_rep_encaisse',      label: t('settings.perm_widget_rep_encaisse'),      icon: <TrendingUp className="h-4 w-4" /> },
    { key: 'widget_rep_depenses',      label: t('settings.perm_widget_rep_depenses'),      icon: <Receipt className="h-4 w-4" /> },
    { key: 'widget_rep_transactions',  label: t('settings.perm_widget_rep_transactions'),  icon: <ShoppingCart className="h-4 w-4" /> },
    { key: 'widget_rep_marge_brute',   label: t('settings.perm_widget_rep_marge_brute'),   icon: <BarChart2 className="h-4 w-4" /> },
    { key: 'widget_rep_benefice_net',  label: t('settings.perm_widget_rep_benefice_net'),  icon: <CalendarDays className="h-4 w-4" /> },
    { key: 'widget_rep_credits',       label: t('settings.perm_widget_rep_credits'),       icon: <CreditCard className="h-4 w-4" /> },
    { key: 'widget_rep_payment_chart', label: t('settings.perm_widget_rep_payment_chart'), icon: <BarChart2 className="h-4 w-4" /> },
    { key: 'widget_rep_top_products',  label: t('settings.perm_widget_rep_top_products'),  icon: <Package className="h-4 w-4" /> },
    { key: 'widget_rep_cashier_perf',  label: t('settings.perm_widget_rep_cashier_perf'),  icon: <Users className="h-4 w-4" /> },
  ]

  const ROLE_LABELS: Record<ConfigurableRole, string> = {
    shop_manager:  t('roles.shop_manager'),
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
      setCountry((shopData.country as CountryCode) || 'NG')
      setCurrency(resolveCurrencyCode(shopData.currency, shopData.country))
      setWhatsapp(shopData.whatsapp || COUNTRIES[(shopData.country as CountryCode) || 'NG']?.phonePrefix.replace('+', '') || '')
      setReceiptTagline(shopData.receipt_tagline ?? '')
      setReceiptLegalIds(shopData.receipt_legal_ids ?? '')
      setReceiptFooter(shopData.receipt_footer ?? '')
      setThreshold(String(shopData.low_stock_threshold))
      setTaxRate(String(shopData.tax_rate))
      setExpiryAlertDays(String((shopData as any).expiry_alert_days ?? 14))
      setDefaultCreditTermDays(String((shopData as any).default_credit_term_days ?? 30))
      setHoursEnabled(shopData.hours_enabled ?? false)
      setOpeningTime((shopData.opening_time ?? '08:00').slice(0, 5))
      setClosingTime((shopData.closing_time ?? '20:00').slice(0, 5))
      setHoursOverride(shopData.hours_manual_override === 'open' ? 'open' : shopData.hours_manual_override === 'closed' ? 'closed' : 'auto')

      setNotifyEmailLowStock(shopData.notify_email_low_stock)
      setNotifyEmailDaily(shopData.notify_email_daily)
      setNotifyEmailExpiry((shopData as any).notify_email_expiry ?? true)
      setNotifyPushNewSale(shopData.notify_push_new_sale ?? true)
      setNotifyPushNewExpense(shopData.notify_push_new_expense ?? true)
      setNotifyPushExpiry((shopData as any).notify_push_expiry ?? true)
      setLoading(false)
      // Réglages enregistrés fusionnés par la règle unique (mergeRolePerms) :
      // le niveau affiché est exactement celui que le serveur applique, y
      // compris pour les anciens « oui » explicites (= modification conservée).
      const stored = (shopData as any).role_permissions as StoredPermissions | null
      if (stored) {
        setPermissions({
          shop_manager:  mergeRolePerms('shop_manager', stored),
          manager:       mergeRolePerms('manager', stored),
          cashier:       mergeRolePerms('cashier', stored),
          viewer:        mergeRolePerms('viewer', stored),
          stock_manager: mergeRolePerms('stock_manager', stored),
        })
        setGeneralPerms({ ...DEFAULT_GENERAL, ...(stored.general ?? {}) })
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

  const testPush = async () => {
    if (!shop?.id) return
    setTestingPush(true)
    try {
      const res = await withTimeout(fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id }),
      }))
      const data = await res.json()
      if (data.error === 'no_subscription') {
        toast({ title: t('settings.no_subscription_found'), variant: 'destructive' })
      } else if (data.ok) {
        toast({ title: t('settings.test_notification_sent'), variant: 'success' })
      } else {
        toast({ title: data.error || 'Erreur', variant: 'destructive' })
      }
    } finally {
      setTestingPush(false)
    }
  }

  const saveSettings = async () => {
    if (!shop?.id) return
    if (hoursEnabled && closingTime <= openingTime) {
      toast({ title: t('settings.hours_invalid_range'), variant: 'destructive' })
      return
    }
    setSaving(true)
    const updates = {
      name: name.trim(),
      city,
      state,
      country,
      currency,
      whatsapp: whatsapp || null,
      receipt_tagline: receiptTagline.trim() || null,
      receipt_legal_ids: receiptLegalIds.trim() || null,
      receipt_footer: receiptFooter.trim() || null,
      low_stock_threshold: Math.max(1, Number(threshold) || 1),
      tax_rate: Math.max(0, Number(taxRate) || 0),
      expiry_alert_days: Math.max(1, Number(expiryAlertDays) || 1),
      default_credit_term_days: Math.max(1, Number(defaultCreditTermDays) || 1),

      hours_enabled: hoursEnabled,
      opening_time: openingTime,
      closing_time: closingTime,
      hours_manual_override: hoursOverride === 'auto' ? null : hoursOverride,

      notify_email_low_stock: notifyEmailLowStock,
      notify_email_daily: notifyEmailDaily,
      notify_email_expiry: notifyEmailExpiry,
      notify_push_new_sale: notifyPushNewSale,
      notify_push_new_expense: notifyPushNewExpense,
      notify_push_expiry: notifyPushExpiry,
    }
    try {
      const res = await withTimeout(fetch('/api/shops/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, ...updates }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      // Update local state immediately
      setShop(prev => prev ? { ...prev, ...updates } : prev)
      // Sync the global auth context — patchShop is the source of truth here
      // since it uses exactly what was saved. refreshShop() reads from a replica
      // that may have lag, which would revert the currency/country back to the old value.
      patchShop(shop.id, updates)
      // Non-blocking background refresh after a short delay to catch any other
      // server-side changes (triggers, computed columns) without reverting patchShop.
      setTimeout(() => refreshShop().catch(() => {}), 3000)
      toast({ title: t('settings.saved'), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || t('toast.network_error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !shop?.id) return
    setUploadingLogo(true)
    try {
      // Normalisé avant l'envoi : marges retirées, proportions gardées, 512 px
      // max, fond blanc, PNG (un JPEG rendait noir le fond d'un logo transparent)
      const { blob } = await prepareLogo(file)
      // Même chemin à chaque import : l'ancien fichier est remplacé
      const path = `${shop.id}/logo.png`
      const { error: uploadError } = await withTimeout<any>(supabase.storage
        .from('shop-logos')
        .upload(path, blob, { upsert: true, contentType: 'image/png' }))
      if (uploadError) throw uploadError

      // Add timestamp to bust CDN cache
      const { data: { publicUrl } } = supabase.storage.from('shop-logos').getPublicUrl(path)
      const urlWithBust = `${publicUrl}?t=${Date.now()}`

      await withTimeout(supabase.from('shops').update({ logo_url: urlWithBust }).eq('id', shop.id))

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

  // Enregistre le JSON COMPLET (5 rôles + « general ») : le PATCH remplace
  // tout le bloc, un envoi partiel effacerait les autres réglages.
  const savePermissions = async (roles: AllPerms, general: Record<PermFeature, boolean>, rollback: () => void) => {
    if (!shop?.id) return
    setSavingPerms(true)
    const payload = { ...roles, general }
    try {
      const res = await withTimeout(fetch('/api/team/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, role_permissions: payload }),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur inconnue')
      // Contexte mis à jour directement — évite une relecture périmée après écriture
      patchShop(shop.id, { role_permissions: payload })
      toast({ title: t('settings.perms_saved'), description: t('settings.perms_saved_desc'), variant: 'success' })
    } catch (err: any) {
      toast({ title: t('settings.perms_error'), description: err.message, variant: 'destructive' })
      rollback()
    } finally {
      setSavingPerms(false)
    }
  }

  const togglePermission = (role: ConfigurableRole, feature: PermFeature, value: boolean) => {
    const prev = permissions
    const updated: AllPerms = { ...permissions, [role]: { ...permissions[role], [feature]: value } }
    setPermissions(updated)
    void savePermissions(updated, generalPerms, () => setPermissions(prev))
  }

  // Pages à trois niveaux (masqué · lecture · modification). L'Observateur
  // n'a jamais « modification » : la règle unique l'ignorerait de toute façon.
  const setPermLevel = (role: ConfigurableRole, feature: LevelFeature, level: Level) => {
    if (level === 'write' && role === 'viewer') return
    const prev = permissions
    const updated: AllPerms = { ...permissions, [role]: withLevel(permissions[role], feature, level) }
    setPermissions(updated)
    void savePermissions(updated, generalPerms, () => setPermissions(prev))
  }

  const toggleGeneralPermission = (feature: PermFeature, value: boolean) => {
    const prev = generalPerms
    const updated = { ...generalPerms, [feature]: value }
    setGeneralPerms(updated)
    void savePermissions(permissions, updated, () => setGeneralPerms(prev))
  }

  const isPermChecked = (key: PermFeature) => activePermRole === 'general' ? generalPerms[key] : permissions[activePermRole][key]
  const onPermToggle = (key: PermFeature, val: boolean) =>
    activePermRole === 'general' ? toggleGeneralPermission(key, val) : togglePermission(activePermRole, key, val)

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    updateLocale(newLocale)
    router.replace(newPath)
  }

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>

  return (
    <div className="space-y-4 max-w-5xl">

      {/* Entreprise (racine du compte) : nom, propriétaire, facturation, abonnement */}
      {isOwner && <CompanyCard />}

      {/* Owner-only sections: shop info, business settings, notifications */}
      {isOwner && (
        <>
          {/* Parrainage & récompenses */}
          <Link href={`/${locale}/settings/referrals`}>
            <Card className="border-0 shadow-sm hover:bg-accent/40 transition-colors cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-stockshop-blue/10 flex items-center justify-center flex-shrink-0">
                  <Gift className="h-5 w-5 text-stockshop-blue dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t('settings.referrals_title')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.referrals_subtitle')}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>
          </Link>

          {/* Shop Info */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t('settings.shop_info')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <ShopLogo src={shop?.logo_url} name={shop?.name || name} size="lg" shape="auto" />
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
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.shop_name_example')} />
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.whatsapp')}</Label>
                  <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="2348012345678" type="tel" />
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.city')}</Label>
                  <Input value={city} onChange={e => setCity(e.target.value)} placeholder={t('settings.city_example')} />
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.state')}</Label>
                  <Input value={state} onChange={e => setState(e.target.value)} placeholder={t('settings.state_example')} />
                </div>
              </div>

              {/* Country + Currency */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>{t('settings.operating_country')}</Label>
                  <CountrySelect
                    value={country}
                    onChange={code => {
                      const oldPrefix = COUNTRIES[country]?.phonePrefix.replace('+', '') || ''
                      // Only swap the dial code prefix if the field is still untouched (empty or just the previous prefix)
                      if (!whatsapp || whatsapp === oldPrefix) {
                        setWhatsapp(COUNTRIES[code]?.phonePrefix.replace('+', '') || '')
                      }
                      setCountry(code)
                      setCurrency(COUNTRIES[code]?.currency || 'NGN')
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.display_and_currency')}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.currency_label')}</Label>
                  <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted px-3">
                    <span className="text-lg">{COUNTRIES[country]?.flag || '🌐'}</span>
                    <span className="font-semibold text-foreground">{currencySymbol(currency) || currency}</span>
                    <span className="text-xs text-muted-foreground ml-1">{currency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('settings.currency_auto_hint')}</p>
                </div>
              </div>

              {/* Identité imprimée sur les reçus et tickets (migration 149) */}
              <div className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium">{t('settings.receipt_section')}</p>
                <div className="space-y-1">
                  <Label>{t('settings.receipt_tagline')}</Label>
                  <Input value={receiptTagline} maxLength={80} onChange={e => setReceiptTagline(e.target.value)} placeholder={t('settings.receipt_tagline_example')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>{t('settings.receipt_legal_ids')}</Label>
                    <Textarea value={receiptLegalIds} maxLength={300} rows={3} onChange={e => setReceiptLegalIds(e.target.value)} placeholder={t('settings.receipt_legal_ids_example')} />
                    <p className="text-xs text-muted-foreground">{t('settings.receipt_legal_ids_hint')}</p>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('settings.receipt_footer')}</Label>
                    <Textarea value={receiptFooter} maxLength={200} rows={3} onChange={e => setReceiptFooter(e.target.value)} placeholder={t('settings.receipt_footer_example')} />
                    <p className="text-xs text-muted-foreground">{t('settings.receipt_footer_hint')}</p>
                  </div>
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
                  <Input type="number" min={1} value={threshold} onChange={e => setThreshold(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('settings.stock_alert_hint')}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.tax_rate')}</Label>
                  <div className="relative">
                    <Input type="number" min={0} max={100} step={0.5} value={taxRate} onChange={e => setTaxRate(e.target.value)} className="pr-8" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('settings.tax_hint')}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.expiry_alert_days')}</Label>
                  <Input type="number" min={1} value={expiryAlertDays} onChange={e => setExpiryAlertDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('settings.expiry_alert_hint')}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t('settings.default_credit_term_days')}</Label>
                  <Input type="number" min={1} value={defaultCreditTermDays} onChange={e => setDefaultCreditTermDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('settings.default_credit_term_hint')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Horaires d'ouverture */}
          {canManageHours && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t('settings.hours_title')}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t('settings.hours_desc')}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>{t('settings.hours_enabled')}</Label>
                  <Switch checked={hoursEnabled} onCheckedChange={setHoursEnabled} />
                </div>

                {hoursEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label>{t('settings.hours_opening')}</Label>
                        <Input type="time" value={openingTime} onChange={e => setOpeningTime(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('settings.hours_closing')}</Label>
                        <Input type="time" value={closingTime} onChange={e => setClosingTime(e.target.value)} />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>{t('settings.hours_override')}</Label>
                      <div className="flex gap-2 flex-wrap">
                        {([
                          ['auto', t('settings.hours_override_auto')],
                          ['open', t('settings.hours_override_open')],
                          ['closed', t('settings.hours_override_closed')],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setHoursOverride(value)}
                            className={cn(
                              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border',
                              hoursOverride === value
                                ? 'bg-stockshop-blue text-white border-stockshop-blue dark:border-blue-500'
                                : 'border-border text-muted-foreground hover:bg-muted'
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {hoursOverride !== 'auto' && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        {t('settings.hours_override_warning')}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notifications — ancre « #notifications » : lien « Gérer mes alertes » des e-mails */}
          <Card id="notifications" className="scroll-mt-20 border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t('settings.notifications')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">{t('settings.notif_hint')}</p>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('settings.email_section_label')}</p>
                {[
                  { label: t('settings.alert_low_stock'), value: notifyEmailLowStock, setter: setNotifyEmailLowStock },
                  { label: t('settings.alert_daily'), value: notifyEmailDaily, setter: setNotifyEmailDaily },
                  { label: t('settings.alert_expiry'), value: notifyEmailExpiry, setter: setNotifyEmailExpiry },
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
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-1">
                        <div>
                          <Label className="cursor-pointer">{t('settings.push_new_sale_label')}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('settings.push_new_sale_hint')}
                          </p>
                        </div>
                        <Switch
                          checked={notifyPushNewSale}
                          onCheckedChange={v => setNotifyPushNewSale(v)}
                        />
                      </div>
                      {notifyPushNewSale && (
                        <>
                          <div className="flex items-center justify-between py-1 pl-3 border-l-2 border-muted">
                            <div>
                              <Label className="cursor-pointer text-sm text-muted-foreground">{t('settings.sound_label')}</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {t('settings.sound_hint')}
                              </p>
                            </div>
                            <Switch
                              checked={saleSoundEnabled}
                              onCheckedChange={v => {
                                setSaleSoundEnabled(v)
                                localStorage.setItem('sale_sound_enabled', v ? '1' : '0')
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between py-1 pl-3 border-l-2 border-muted">
                            <div>
                              <Label className="cursor-pointer text-sm text-muted-foreground">{t('settings.vibration_label')}</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {t('settings.vibration_hint')}
                              </p>
                            </div>
                            <Switch
                              checked={saleVibrationEnabled}
                              onCheckedChange={v => {
                                setSaleVibrationEnabled(v)
                                localStorage.setItem('sale_vibration_enabled', v ? '1' : '0')
                              }}
                            />
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between py-1">
                        <div>
                          <Label className="cursor-pointer">{t('settings.push_new_expense_label')}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('settings.push_new_expense_hint')}
                          </p>
                        </div>
                        <Switch
                          checked={notifyPushNewExpense}
                          onCheckedChange={v => setNotifyPushNewExpense(v)}
                        />
                      </div>
                      <div className="flex items-center justify-between py-1">
                        <div>
                          <Label className="cursor-pointer">{t('settings.alert_expiry')}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('settings.expiry_alert_hint')}</p>
                        </div>
                        <Switch
                          checked={notifyPushExpiry}
                          onCheckedChange={v => setNotifyPushExpiry(v)}
                        />
                      </div>
                    </div>
                    {pushEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={testPush}
                        disabled={testingPush}
                      >
                        {testingPush ? 'Envoi...' : 'Tester la notification'}
                      </Button>
                    )}
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
                    ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Impression des tickets — par appareil (chaque caisse a sa propre imprimante) */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Printer className="h-4 w-4" />
            {t('settings.ticket_print_title')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t('settings.ticket_device_note')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('settings.ticket_method')}</p>
            <div className="space-y-2">
              {([
                { id: 'system', label: t('settings.ticket_method_system'), desc: t('settings.ticket_method_system_desc'), available: true, badge: '' },
                { id: 'bluetooth', label: t('settings.ticket_method_bluetooth'), desc: t('settings.ticket_bt_hint'), available: nativeApp, badge: t('settings.ticket_bt_app_only') },
                { id: 'network', label: t('settings.ticket_method_network'), desc: '', available: false, badge: t('settings.ticket_coming_soon') },
              ] as const).map(m => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!m.available}
                  onClick={() => updateTicket({ method: m.id })}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm transition-colors tap-target',
                    ticket.method === m.id
                      ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40'
                      : 'border-input bg-background',
                    !m.available && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{m.label}</span>
                    {m.desc && <span className="block text-xs text-muted-foreground">{m.desc}</span>}
                  </span>
                  {!m.available && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {m.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Bluetooth : imprimante appairée choisie sur cet appareil */}
            {ticket.method === 'bluetooth' && nativeApp && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Bluetooth className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
                  <span className="font-medium">{t('settings.ticket_bt_printer')} :</span>
                  <span className={cn('truncate', !ticket.bluetoothName && 'text-muted-foreground')}>
                    {ticket.bluetoothName || t('settings.ticket_bt_none')}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={loadPairedDevices} loading={btLoading}>
                    <Bluetooth className="h-4 w-4" />{t('settings.ticket_bt_choose')}
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-2" onClick={() => BluetoothPrinter.openSettings().catch(() => {})}>
                    <ChevronRight className="h-4 w-4" />{t('settings.ticket_bt_pair')}
                  </Button>
                </div>
                {btLoading && <p className="text-xs text-muted-foreground">{t('settings.ticket_bt_loading')}</p>}
                {btDevices && (
                  btDevices.length === 0
                    ? <p className="text-xs text-muted-foreground">{t('settings.ticket_bt_no_devices')}</p>
                    : (
                      <div className="space-y-1">
                        {btDevices.map((d, i) => {
                          const isPrinter = d.majorClass === BLUETOOTH_IMAGING_CLASS
                          const firstOther = !isPrinter && (i === 0 || btDevices[i - 1].majorClass === BLUETOOTH_IMAGING_CLASS)
                          return (
                            <div key={d.address}>
                              {i === 0 && isPrinter && <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('settings.ticket_bt_printers')}</p>}
                              {firstOther && <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('settings.ticket_bt_other_devices')}</p>}
                              <button
                                type="button"
                                onClick={() => choosePrinter(d)}
                                className={cn(
                                  'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm tap-target',
                                  ticket.bluetoothAddress === d.address ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40' : 'border-input bg-background hover:bg-muted',
                                )}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  {isPrinter ? <Printer className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Bluetooth className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                  <span className="truncate">{d.name}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{d.address}</span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('settings.ticket_width')}</p>
            <div className="grid grid-cols-2 gap-3">
              {([58, 80] as const).map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => updateTicket({ width: w })}
                  className={cn(
                    'rounded-lg border p-3 text-sm font-medium transition-colors tap-target',
                    ticket.width === w
                      ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400'
                      : 'border-input bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  {w} mm
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('settings.ticket_auto_print')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('settings.ticket_auto_print_desc')}</p>
            </div>
            <Switch checked={ticket.autoPrint} onCheckedChange={v => updateTicket({ autoPrint: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('settings.receipt_auto_whatsapp')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('settings.receipt_auto_whatsapp_desc')}</p>
            </div>
            <Switch checked={ticket.autoWhatsApp} onCheckedChange={v => updateTicket({ autoWhatsApp: v })} data-testid="settings-auto-whatsapp" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('settings.ticket_print_logo')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {shop?.logo_url ? t('settings.ticket_print_logo_desc') : t('settings.ticket_print_logo_none')}
              </p>
            </div>
            <Switch checked={!!ticket.printLogo && !!shop?.logo_url} disabled={!shop?.logo_url} onCheckedChange={v => updateTicket({ printLogo: v })} />
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={printTestTicket} loading={testPrinting}>
            <Printer className="h-4 w-4" />
            {t('settings.ticket_test_print')}
          </Button>
        </CardContent>
      </Card>

      {/* Role Permissions — owner only */}
      {canEditPermissions && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
              {t('settings.role_permissions')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t('settings.role_permissions_desc')}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Role tabs */}
            <div className="flex gap-2 flex-wrap items-center">
              <button
                onClick={() => setActivePermRole('general')}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border flex items-center gap-1.5',
                  activePermRole === 'general'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'border-amber-300 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 dark:border-amber-800 dark:text-amber-400'
                )}
              >
                <Globe className="h-3.5 w-3.5" />
                {t('settings.perm_general_tab')}
              </button>
              <div className="w-px h-5 bg-border mx-1" />
              {(['shop_manager', 'manager', 'cashier', 'viewer', 'stock_manager'] as ConfigurableRole[]).map(r => (
                <button
                  key={r}
                  onClick={() => setActivePermRole(r)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border',
                    activePermRole === r
                      ? 'bg-stockshop-blue text-white border-stockshop-blue dark:border-blue-500'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
              {savingPerms && <span className="text-xs text-muted-foreground self-center ml-1">{t('settings.saving_perms')}</span>}
            </div>

            {activePermRole === 'general' && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                {t('settings.perm_general_warning')}
              </div>
            )}

            {/* Fonctions : pages à trois niveaux, actions à interrupteur */}
            {activePermRole !== 'general' && (
              <p className="px-3 text-xs text-muted-foreground">{t('settings.perm_levels_hint')}</p>
            )}
            {activePermRole === 'viewer' && (
              <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="perm-viewer-readonly">
                {t('settings.perm_viewer_readonly')}
              </div>
            )}
            <div className="space-y-1">
              {PERM_FEATURES.map(({ key, label, icon }) => {
                const withLevels = activePermRole !== 'general' && isLevelFeature(key)
                return (
                <div key={key} className={cn('rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors', withLevels ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between' : 'flex items-center justify-between gap-3')}>
                  <div className="flex items-center gap-2.5 text-sm min-w-0">
                    <span className="text-muted-foreground flex-shrink-0">{icon}</span>
                    <span>{label}</span>
                  </div>
                  {withLevels ? (
                    // Téléphone : sous le libellé, pleine largeur ; grand écran : à droite
                    <div className="flex w-full overflow-hidden rounded-lg border border-border text-xs sm:w-auto sm:flex-shrink-0" role="radiogroup" data-testid={`perm-level-${key}`}>
                      {(['hidden', 'read', 'write'] as Level[]).map(lvl => {
                        const current = levelOf(permissions[activePermRole], activePermRole, key)
                        const disabled = lvl === 'write' && activePermRole === 'viewer'
                        return (
                          <button
                            key={lvl} type="button" role="radio" aria-checked={current === lvl} disabled={disabled}
                            onClick={() => setPermLevel(activePermRole, key, lvl)}
                            className={cn(
                              'flex-1 px-2.5 py-2 font-medium transition-colors sm:flex-none sm:py-1.5',
                              current === lvl ? 'bg-stockshop-blue text-white dark:bg-blue-500' : 'text-muted-foreground hover:bg-muted',
                              disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                            )}
                          >
                            {t(`settings.perm_level_${lvl}`)}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <Switch
                      checked={activePermRole === 'viewer' && isViewerLocked(key) ? false : isPermChecked(key)}
                      disabled={activePermRole === 'viewer' && isViewerLocked(key)}
                      onCheckedChange={val => onPermToggle(key, val)}
                    />
                  )}
                </div>
                )
              })}
            </div>

            {/* Dashboard widget toggles */}
            <div>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('settings.perm_section_dashboard')}
              </p>
              <div className="space-y-1">
                {DASHBOARD_WIDGET_FEATURES.map(({ key, label, icon }) => (
                  <div key={key} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="text-muted-foreground">{icon}</span>
                      <span>{label}</span>
                    </div>
                    <Switch
                      checked={isPermChecked(key)}
                      onCheckedChange={val => onPermToggle(key, val)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Reports widget toggles */}
            <div>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('settings.perm_section_reports')}
              </p>
              <div className="space-y-1">
                {REPORT_WIDGET_FEATURES.map(({ key, label, icon }) => (
                  <div key={key} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="text-muted-foreground">{icon}</span>
                      <span>{label}</span>
                    </div>
                    <Switch
                      checked={isPermChecked(key)}
                      onCheckedChange={val => onPermToggle(key, val)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save button — owner only */}
      {isOwner && (
        <Button
          onClick={saveSettings}
          loading={saving}
          variant="stockshop"
          className="w-full"
          size="sm"
        >
          <Save className="mr-2 h-4 w-4" />
          {t('actions.save')}
        </Button>
      )}
    </div>
  )
}
