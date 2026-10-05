'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations, useLocale } from 'next-intl'
import { normalize } from '@/lib/utils/normalize'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { InputGroup, RequiredMark } from '@/components/ui/input-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Pencil, Trash2, Receipt, RefreshCw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Target, FileDown, FileText, Table2, Camera, Paperclip, X, WifiOff, Clock, AlertTriangle, Search, Copy, TrendingUp, TrendingDown, ExternalLink, Save } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrency } from '@/lib/hooks/use-currency'
import { NumericInput } from '@/components/ui/numeric-input'
import { format, startOfMonth, endOfMonth, addMonths, addWeeks } from 'date-fns'
import type { Expense, ExpenseBudget } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { savePendingExpense, getPendingExpenses, type PendingExpense } from '@/lib/offline/db'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'

import { cn } from '@/lib/utils/cn'
import { withTimeout } from '@/lib/utils/with-timeout'
import { compressImage } from '@/lib/utils/compress-image'
import { hasNativePhotoPicker, pickPhotoNative, PhotoPermissionError } from '@/lib/photo/pick-photo'
import { useRestoredPhoto } from '@/lib/photo/use-restored-photo'
import { generateExpensesReportPDF } from '@/lib/utils/pdf'
import { downloadOrShareCSV } from '@/lib/utils/native-share'

const supabase = createClient() as any

const EXPENSE_CATEGORIES = [
  { id: 'rent',        icon: '🏠', color: 'bg-stockshop-blue-muted dark:bg-blue-900/40 text-stockshop-blue dark:text-blue-300' },
  { id: 'electricity', icon: '⚡', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  { id: 'water',       icon: '💧', color: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  { id: 'salaries',    icon: '👥', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  { id: 'transport',   icon: '🚗', color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
  { id: 'supplies',    icon: '📦', color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  { id: 'internet',    icon: '📱', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  { id: 'maintenance', icon: '🔧', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
  { id: 'marketing',   icon: '📢', color: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300' },
  { id: 'other',       icon: '📝', color: 'bg-muted text-muted-foreground' },
] as const

type CategoryId = typeof EXPENSE_CATEGORIES[number]['id']
type PaymentMethod = 'cash' | 'mobile_money' | 'bank_transfer'

const PAYMENT_METHODS: { id: PaymentMethod; icon: string }[] = [
  { id: 'cash',          icon: '💵' },
  { id: 'mobile_money',  icon: '📲' },
  { id: 'bank_transfer', icon: '🏦' },
]

function catFor(id: string) {
  return EXPENSE_CATEGORIES.find(c => c.id === id) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
}

function advanceNextDue(dateStr: string, recurrence: 'weekly' | 'monthly', day?: number | null): string {
  const d = new Date(dateStr + 'T12:00:00')
  if (recurrence === 'monthly') {
    const next = addMonths(d, 1)
    if (day) next.setDate(Math.min(day, 28))
    return format(next, 'yyyy-MM-dd')
  }
  return format(addWeeks(d, 1), 'yyyy-MM-dd')
}

export default function ExpensesPage() {
  const { shop, effectiveShopIds, profile, roleInActiveShop } = useAuth()
  const [{ monthFilter, categoryFilter, paymentFilter }, setFilter] = usePersistedFilters(
    'expenses', shop?.id, { monthFilter: format(new Date(), 'yyyy-MM'), categoryFilter: 'all', paymentFilter: 'all' }
  )
  const [search, setSearch] = useState('')
  const locale = useLocale()
  const { toast } = useToast()
  const { fmt, symbol } = useCurrency()
  const t = useTranslations('expenses')
  const tPhoto = useTranslations('photo')
  const tRoot = useTranslations()
  const { canAccess } = useRolePermissions()
  // manager/shop_manager keep unconditional access, matching the API route —
  // see DELETE_EXPENSES_ALWAYS_ALLOW in app/api/expenses/delete/route.ts.
  const effectiveRole = roleInActiveShop ?? profile?.role
  const canDeleteExpenses = effectiveRole === 'manager' || effectiveRole === 'shop_manager' || canAccess('delete_expenses')
  const tA = useTranslations('actions')

  const [expenses, setExpenses]       = useState<Expense[]>(() =>
    getPageCache<Expense[]>(`expenses_${effectiveShopIds.join(',')}_${monthFilter}`) || []
  )
  const [templates, setTemplates]     = useState<Expense[]>([])
  const [budgets, setBudgets]         = useState<Record<string, number>>({})
  const [loading, setLoading]         = useState(() =>
    !getPageCache(`expenses_${effectiveShopIds.join(',')}_${monthFilter}`)
  )
  const [saving, setSaving]           = useState(false)
  const [savingBudget, setSavingBudget] = useState(false)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: string | null; isTemplate: boolean }>({ open: false, id: null, isTemplate: false })

  type DeleteLog = {
    id: string
    created_at: string
    actor_email: string | null
    metadata: { amount: number; category: string; description: string; date: string; is_recurring: boolean }
  }
  const [deleteLogs, setDeleteLogs] = useState<DeleteLog[]>([])
  const [showTemplates, setShowTemplates] = useState(true)
  const [showBudgets, setShowBudgets] = useState(true)
  const [view, setView] = useState<'expenses' | 'journal'>('expenses')
  const [exporting, setExporting]     = useState(false)
  // Mois précédent (total et par catégorie) pour la comparaison « vs mois dernier »
  const [prevTotals, setPrevTotals] = useState<{ total: number; byCat: Record<string, number> } | null>(null)
  // Fiche d'une dépense (panneau de consultation)
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null)
  // Instantané du formulaire à l'ouverture : la garde de fermeture compare
  const [formInitial, setFormInitial] = useState('')
  const [deleteBudgetConfirm, setDeleteBudgetConfirm] = useState(false)
  const [deletingBudget, setDeletingBudget] = useState(false)

  const { isOnline: isReallyOnline } = useOffline()
  const [pendingExpenses, setPendingExpenses] = useState<PendingExpense[]>([])

  // Expense modal state
  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState<Expense | null>(null)
  const [amount, setAmount]           = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate]               = useState(format(new Date(), 'yyyy-MM-dd'))
  const [category, setCategory]       = useState<CategoryId>('other')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence]   = useState<'monthly' | 'weekly'>('monthly')
  const [recurrenceDay, setRecurrenceDay] = useState(1)
  const [receiptFile, setReceiptFile]     = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  // Web : <input type="file"> cachés (caméra du téléphone / fichier image ou PDF)
  const receiptCameraRef = useRef<HTMLInputElement>(null)
  const receiptFileRef = useRef<HTMLInputElement>(null)

  // Budget modal state
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [budgetCategory, setBudgetCategory]   = useState<CategoryId>('other')
  const [budgetAmount, setBudgetAmount]       = useState('')

  useEffect(() => {
    // Refresh pending expense list ~3s after coming back online (sync has likely completed by then)
    const on = () => {
      if (shop?.id) setTimeout(() => getPendingExpenses(shop.id!).then(setPendingExpenses), 3000)
    }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [shop?.id])

  // Load pending (offline) expenses from IndexedDB on mount and after shop changes
  useEffect(() => {
    if (!shop?.id) return
    getPendingExpenses(shop.id).then(setPendingExpenses)
  }, [shop?.id])

  const shopIdsKey = effectiveShopIds.join(',')

  const fetchExpenses = useCallback(async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `expenses_${shopIdsKey}_${monthFilter}`
    const cached = getPageCache<Expense[]>(cacheKey)
    if (cached) {
      setExpenses(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    if (!isReallyOnline) {
      // No cache for this month and no network to fetch fresh — without this,
      // loading stayed true forever (stuck skeleton) instead of showing a
      // genuinely empty state.
      if (!cached) { setExpenses([]); setLoading(false) }
      return
    }
    const start = startOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    const end   = endOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    const prevMonth = addMonths(new Date(monthFilter + '-01'), -1)
    const prevStart = startOfMonth(prevMonth).toISOString().slice(0, 10)
    const prevEnd   = endOfMonth(prevMonth).toISOString().slice(0, 10)
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const [{ data: expData, error: expErr }, { data: tplData }, { data: prevData }] = await withTimeout(Promise.all([
        supabase
          .from('expenses')
          .select('*')
          .in('shop_id', effectiveShopIds)
          .eq('is_recurring', false)
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: false }),
        supabase
          .from('expenses')
          .select('*')
          .in('shop_id', effectiveShopIds)
          .eq('is_recurring', true)
          .order('description'),
        // Mois précédent : seulement montant et catégorie, pour la comparaison
        supabase
          .from('expenses')
          .select('amount, category')
          .in('shop_id', effectiveShopIds)
          .eq('is_recurring', false)
          .gte('date', prevStart)
          .lte('date', prevEnd),
      ]), 20_000, t('load_timeout'))
      if (expErr) {
        // Only alarm the user when there's nothing already on screen — a
        // silent background refresh (e.g. after returning from a backgrounded
        // tab) failing shouldn't show a scary error over data that's still valid.
        if (!cached) toast({ title: expErr.message, variant: 'destructive' })
        return
      }
      setExpenses((expData || []) as Expense[])
      setTemplates((tplData || []) as Expense[])
      setPageCache(cacheKey, expData || [])
      const byCat: Record<string, number> = {}
      let prevTotal = 0
      for (const row of (prevData || []) as { amount: number; category: string | null }[]) {
        const amt = Number(row.amount) || 0
        prevTotal += amt
        const key = row.category || 'other'
        byCat[key] = (byCat[key] || 0) + amt
      }
      setPrevTotals({ total: prevTotal, byCat })
    } catch (err: any) {
      if (!cached) toast({ title: err.message || 'Erreur chargement', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [shopIdsKey, monthFilter, isReallyOnline])

  const fetchBudgets = useCallback(async () => {
    if (!shop?.id || !isReallyOnline) return
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave a hung request retried forever.
      const { data } = await withTimeout<any>(
        supabase.from('expense_budgets').select('category, amount').eq('shop_id', shop.id),
        20_000
      )
      if (!data) return
      const map: Record<string, number> = {}
      ;(data as ExpenseBudget[]).forEach(b => { map[b.category] = Number(b.amount) })
      setBudgets(map)
    } catch {
      // budgets bar just keeps showing its last known values
    }
  }, [shop?.id, isReallyOnline])

  const isOwnerOrAdmin = profile?.role === 'owner' || profile?.role === 'super_admin'

  const fetchDeleteLogs = useCallback(async () => {
    if (!shop?.id || !isOwnerOrAdmin || !isReallyOnline) return
    try {
      const { data, error } = await withTimeout<any>(supabase
        .from('audit_logs')
        .select('id, created_at, actor_email, metadata')
        .eq('shop_id', shop.id)
        .eq('action', 'expense.delete')
        .order('created_at', { ascending: false })
        .limit(50), 20_000)
      if (error) throw error
      setDeleteLogs((data || []) as DeleteLog[])
    } catch {
      // journal just stays empty/stale — non-critical secondary tab
    }
  }, [shop?.id, isOwnerOrAdmin, isReallyOnline])

  const generateDueRecurring = useCallback(async () => {
    if (!effectiveShopIds.length || !isReallyOnline) return
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: due } = await supabase
      .from('expenses')
      .select('*')
      .in('shop_id', effectiveShopIds)
      .eq('is_recurring', true)
      .lte('next_due_at', today)
      .not('next_due_at', 'is', null)
    if (!due?.length) return

    let count = 0
    for (const tpl of due as Expense[]) {
      let dueDate = tpl.next_due_at!
      while (dueDate <= today) {
        await supabase.from('expenses').insert({
          shop_id:        tpl.shop_id,
          amount:         tpl.amount,
          description:    tpl.description,
          category:       tpl.category ?? 'other',
          payment_method: tpl.payment_method ?? 'cash',
          date:           dueDate,
          is_recurring:   false,
          template_id:    tpl.id,
        })
        count++
        dueDate = advanceNextDue(dueDate, tpl.recurrence!, tpl.recurrence_day)
      }
      await supabase.from('expenses').update({ next_due_at: dueDate }).eq('id', tpl.id)
    }

    if (count > 0) {
      const label = count > 1 ? t('recurring_generated_plural', { n: count }) : t('recurring_generated_one')
      toast({ title: label, variant: 'success' })
      fetchExpenses()
      if (shop?.id) {
        fetch('/api/push/recurring-expense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop_id: shop.id, count }),
        }).catch(() => {})
      }
    }
  }, [shopIdsKey, fetchExpenses, shop?.id, isReallyOnline])

  useEffect(() => {
    fetchExpenses()
    fetchBudgets()
    fetchDeleteLogs()
    generateDueRecurring()
  }, [shopIdsKey, monthFilter])

  // Refresh when the user comes back to this tab — catches expenses added/
  // edited by other team members in the meantime.
  const refreshExpensesData = useCallback(() => {
    fetchExpenses(); fetchBudgets(); fetchDeleteLogs()
  }, [fetchExpenses, fetchBudgets, fetchDeleteLogs])
  useRefetchOnVisible(refreshExpensesData)
  useRefetchOnReconnect(refreshExpensesData, isReallyOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  // ─── Expense CRUD ────────────────────────────────────────────────────────

  // Instantané des valeurs du formulaire (garde « modifications non enregistrées »)
  const snapOf = (v: { amount: string; description: string; date: string; category: string; paymentMethod: string; isRecurring: boolean; recurrence: string; recurrenceDay: number; receiptPreview: string | null }) => JSON.stringify(v)
  const formSnapshot = () => snapOf({ amount, description, date, category, paymentMethod, isRecurring, recurrence, recurrenceDay, receiptPreview })
  const formDirty = modalOpen && (formSnapshot() !== formInitial || !!receiptFile)

  const openAdd = () => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const day = Math.min(new Date().getDate(), 28)
    setEditing(null)
    setAmount('')
    setDescription('')
    setDate(today)
    setCategory('other')
    setPaymentMethod('cash')
    setIsRecurring(false)
    setRecurrence('monthly')
    setRecurrenceDay(day)
    setReceiptFile(null)
    setReceiptPreview(null)
    setFormInitial(snapOf({ amount: '', description: '', date: today, category: 'other', paymentMethod: 'cash', isRecurring: false, recurrence: 'monthly', recurrenceDay: day, receiptPreview: null }))
    supabase.auth.getSession().catch(() => {})
    setModalOpen(true)
  }

  const openEdit = (exp: Expense) => {
    const values = {
      amount: String(exp.amount), description: exp.description, date: exp.date,
      category: (exp.category as CategoryId) || 'other', paymentMethod: exp.payment_method ?? 'cash',
      isRecurring: exp.is_recurring ?? false, recurrence: exp.recurrence ?? 'monthly', recurrenceDay: exp.recurrence_day ?? 1,
      receiptPreview: exp.receipt_url ?? null,
    }
    setEditing(exp)
    setAmount(values.amount)
    setDescription(values.description)
    setDate(values.date)
    setCategory(values.category as CategoryId)
    setPaymentMethod(values.paymentMethod as PaymentMethod)
    setIsRecurring(values.isRecurring)
    setRecurrence(values.recurrence as 'monthly' | 'weekly')
    setRecurrenceDay(values.recurrenceDay)
    setReceiptFile(null)
    setReceiptPreview(values.receiptPreview)
    setFormInitial(snapOf(values))
    supabase.auth.getSession().catch(() => {})
    setModalOpen(true)
  }

  // Dupliquer : même dépense, à la date du jour, sans justificatif ni récurrence
  const openDuplicate = (exp: Expense) => {
    openAdd()
    setAmount(String(exp.amount))
    setDescription(exp.description)
    setCategory((exp.category as CategoryId) || 'other')
    setPaymentMethod(exp.payment_method ?? 'cash')
    setDetailExpense(null)
  }

  // Reçu : image compressée comme les photos produits (8 Mo → ~150 Ko), PDF tel quel
  const attachReceipt = async (file: File) => {
    const prepared = file.type.startsWith('image/') ? await compressImage(file).catch(() => file) : file
    setReceiptFile(prepared)
    setReceiptPreview(URL.createObjectURL(prepared))
  }

  const onReceiptInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void attachReceipt(file)
  }

  // Application native : prise de vue via le plugin Camera, saisie mise de côté
  // pour la reprise si Android détruit l'activité (voir PhotoRestoreHandler).
  // « Fichier » reste le sélecteur système, seul à proposer les PDF.
  // Web/PWA : les <input> cachés, gérés par le navigateur.
  const pickReceipt = async (source: 'camera' | 'file') => {
    if (source === 'file' || !hasNativePhotoPicker()) {
      ;(source === 'camera' ? receiptCameraRef : receiptFileRef).current?.click()
      return
    }
    if (!shop?.id) return
    try {
      const file = await pickPhotoNative('camera', {
        kind: 'expense',
        shopId: shop.id,
        route: window.location.pathname,
        values: { amount, description, date, category, paymentMethod, isRecurring, recurrence, recurrenceDay },
        meta: { editingId: editing?.id ?? null },
      })
      if (file) await attachReceipt(file)
    } catch (err) {
      toast({
        title: err instanceof PhotoPermissionError ? tPhoto('permission_denied') : tPhoto('pick_failed'),
        variant: 'destructive',
      })
    }
  }

  // Reprise : le formulaire est rouvert tel qu'il était, avec la photo si la
  // prise de vue est allée au bout.
  useRestoredPhoto('expense', ({ draft, file }) => {
    const v = draft.values as Record<string, unknown>
    const editingId = draft.meta?.editingId as string | null | undefined
    if (editingId) {
      // La dépense doit être connue (liste en cache ou chargée) ; sinon on
      // n'ouvre rien plutôt que de risquer un doublon en mode ajout.
      const exp = expenses.find(x => x.id === editingId)
      if (!exp) return
      openEdit(exp)
    } else {
      openAdd()
    }
    if (typeof v.amount === 'string') setAmount(v.amount)
    if (typeof v.description === 'string') setDescription(v.description)
    if (typeof v.date === 'string') setDate(v.date)
    if (typeof v.category === 'string') setCategory(v.category as CategoryId)
    if (typeof v.paymentMethod === 'string') setPaymentMethod(v.paymentMethod as PaymentMethod)
    if (typeof v.isRecurring === 'boolean') setIsRecurring(v.isRecurring)
    if (v.recurrence === 'monthly' || v.recurrence === 'weekly') setRecurrence(v.recurrence)
    if (typeof v.recurrenceDay === 'number') setRecurrenceDay(v.recurrenceDay)
    if (file) void attachReceipt(file)
  })

  const uploadReceipt = async (file: File): Promise<string | null> => {
    const ext  = file.name.split('.').pop() ?? 'jpg'
    const path = `${shop!.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('expense-receipts').upload(path, file, { contentType: file.type, upsert: false })
    if (error) return null
    const { data } = supabase.storage.from('expense-receipts').getPublicUrl(path)
    return data.publicUrl
  }

  const deleteReceipt = async (url: string) => {
    const path = url.split('/expense-receipts/')[1]
    if (path) await supabase.storage.from('expense-receipts').remove([decodeURIComponent(path)])
  }

  const handleSave = async () => {
    if (!shop?.id || !amount || !description.trim()) return
    setSaving(true)

    // ── Offline path: save to IndexedDB (non-recurring new expenses only) ──
    if (!isReallyOnline && !editing && !isRecurring) {
      try {
        await savePendingExpense({
          local_id:       crypto.randomUUID(),
          shop_id:        shop.id,
          amount:         Number(amount),
          description:    description.trim(),
          date,
          category,
          payment_method: paymentMethod,
          created_at:     new Date().toISOString(),
          synced:         false,
        })
        const updated = await getPendingExpenses(shop.id)
        setPendingExpenses(updated)
        toast({ title: t('added_offline', { added: t('added') }), variant: 'success' })
        setModalOpen(false)
      } catch (err: any) {
        toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
      } finally {
        setSaving(false)
      }
      return
    }

    let receipt_url = editing?.receipt_url ?? null
    if (receiptFile) {
      if (editing?.receipt_url) await deleteReceipt(editing.receipt_url)
      receipt_url = await uploadReceipt(receiptFile)
    } else if (receiptPreview === null && editing?.receipt_url) {
      // user cleared the receipt
      await deleteReceipt(editing.receipt_url)
      receipt_url = null
    }

    const payload: Partial<Expense> & { shop_id: string } = {
      shop_id:        shop.id,
      amount:         Number(amount),
      description:    description.trim(),
      date,
      category,
      payment_method: paymentMethod,
      is_recurring:   isRecurring,
      recurrence:     isRecurring ? recurrence : null,
      recurrence_day: isRecurring && recurrence === 'monthly' ? recurrenceDay : null,
      // When editing an already-recurring template, keep its existing next_due_at
      // (already advanced past the creation date) instead of resetting it back to
      // the form's `date` field — otherwise saving the template unchanged would
      // push next_due_at into the past and regenerate a duplicate expense.
      next_due_at:    isRecurring ? (editing?.is_recurring ? (editing.next_due_at ?? date) : date) : null,
      template_id:    null,
      receipt_url,
    }
    try {
      let error: any = null
      if (editing) {
        ;({ error } = await withTimeout<any>(
          supabase.from('expenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
        ))
      } else {
        ;({ error } = await withTimeout<any>(supabase.from('expenses').insert(payload)))
      }
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: editing ? t('updated') : (isRecurring ? t('recurring_added') : t('added')), variant: 'success' })

      // Notify owner when a non-owner creates a new (non-recurring) expense
      const role = profile?.role
      if (!editing && !isRecurring && role && role !== 'owner' && role !== 'super_admin') {
        const amountStr = fmt(Math.round(Number(amount)))
        fetch('/api/push/new-expense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: shop!.id,
            description: description.trim(),
            amount_str: amountStr,
            created_by_name: profile?.full_name || null,
          }),
        }).catch(() => {})
      }

      // Budget check (only for new expenses in the displayed month, non-recurring)
      if (!editing && !isRecurring && date.slice(0, 7) === monthFilter && budgets[category]) {
        const currentSpent = catTotals[category] ?? 0
        const projected = currentSpent + Number(amount)
        const budget = budgets[category]
        if (projected >= budget) {
          setTimeout(() => toast({ title: `⚠️ ${t('budget_exceeded', { category: t(`cat_${category}` as any) })}`, variant: 'destructive' }), 400)
        } else if (projected >= budget * 0.8) {
          setTimeout(() => toast({ title: `⚠️ ${t('budget_near_limit', { category: t(`cat_${category}` as any) })}`, variant: 'default' }), 400)
        }
      }

      setModalOpen(false)
      fetchExpenses()
    } catch (err: any) {
      toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
      setTimeout(() => fetchExpenses(), 3_000)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id: string, isTemplate = false) => {
    setDeleteDialog({ open: true, id, isTemplate })
  }

  const confirmDelete = async () => {
    const { id } = deleteDialog
    if (!id || !shop?.id) return
    setDeleteDialog({ open: false, id: null, isTemplate: false })
    setDeleting(id)
    try {
      const res = await withTimeout(fetch('/api/expenses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expense_id: id, shop_id: shop.id }),
      }))
      const data = await (res as Response).json()
      if (!(res as Response).ok) { toast({ title: data.error || 'Erreur', variant: 'destructive' }); return }
      toast({ title: t('deleted'), variant: 'success' })
      fetchExpenses()
      fetchDeleteLogs()
    } catch (err: any) {
      toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  // ─── Budget CRUD ─────────────────────────────────────────────────────────

  const openBudgetModal = (cat: CategoryId) => {
    setBudgetCategory(cat)
    setBudgetAmount(budgets[cat] ? String(budgets[cat]) : '')
    setBudgetModalOpen(true)
  }

  const saveBudget = async () => {
    if (!shop?.id || !budgetAmount) return
    setSavingBudget(true)
    try {
      const { error } = await withTimeout<any>(
        supabase.from('expense_budgets').upsert(
          { shop_id: shop.id, category: budgetCategory, amount: Number(budgetAmount), updated_at: new Date().toISOString() },
          { onConflict: 'shop_id,category' }
        )
      )
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: t('budget_saved'), variant: 'success' })
      setBudgetModalOpen(false)
      setBudgetAmount('')
      fetchBudgets()
    } catch (err: any) {
      toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
    } finally {
      setSavingBudget(false)
    }
  }

  const deleteBudget = async () => {
    if (!shop?.id) return
    setDeletingBudget(true)
    try {
      const { error } = await withTimeout<any>(supabase.from('expense_budgets').delete().eq('shop_id', shop.id).eq('category', budgetCategory))
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: t('budget_deleted'), variant: 'success' })
      setDeleteBudgetConfirm(false)
      setBudgetModalOpen(false)
      setBudgets(prev => { const n = { ...prev }; delete n[budgetCategory]; return n })
    } catch (err: any) {
      toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeletingBudget(false)
    }
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const q = normalize(search.trim())
  const matchesFilters = (category: string | null | undefined, payment: string | null | undefined, description: string) =>
    (categoryFilter === 'all' || (category || 'other') === categoryFilter) &&
    (paymentFilter === 'all' || (payment || 'cash') === paymentFilter) &&
    (!q || normalize(description).includes(q))
  const filtered   = expenses.filter(e => matchesFilters(e.category, e.payment_method, e.description))
  const filteredPending = pendingExpenses.filter(p =>
    p.date.slice(0, 7) === monthFilter && matchesFilters(p.category, p.payment_method, p.description)
  )
  const total      = filtered.reduce((s, e) => s + Number(e.amount), 0)
                   + filteredPending.reduce((s, p) => s + p.amount, 0)
  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  // Comparaison avec le mois précédent (toutes catégories, sans filtre) ; null si rien à comparer
  const monthTotalAll = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const trendPct = (current: number, previous: number | undefined) =>
    previous && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
  const totalTrend = prevTotals ? trendPct(monthTotalAll, prevTotals.total) : null

  // Liste groupée par jour, du plus récent au plus ancien, avec sous-total
  const groupedByDay = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = format(yesterday, 'yyyy-MM-dd')
    const groups: { key: string; label: string; items: Expense[]; total: number }[] = []
    const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''))
    for (const e of sorted) {
      let g = groups[groups.length - 1]
      if (!g || g.key !== e.date) {
        const label = e.date === todayKey ? tRoot('activity_journal.today') : e.date === yesterdayKey ? tRoot('activity_journal.yesterday')
          : new Date(e.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
        g = { key: e.date, label, items: [], total: 0 }
        groups.push(g)
      }
      g.items.push(e)
      g.total += Number(e.amount)
    }
    return groups
  }, [filtered, locale, tRoot])

  const activeCatIds = new Set([
    ...expenses.map(e => e.category || 'other'),
    ...filteredPending.map(p => p.category),
  ])
  const catTotals    = Object.fromEntries(
    EXPENSE_CATEGORIES.map(c => [
      c.id,
      expenses.filter(e => (e.category || 'other') === c.id).reduce((s, e) => s + Number(e.amount), 0)
      + filteredPending.filter(p => p.category === c.id).reduce((s, p) => s + p.amount, 0),
    ])
  )

  // Categories to show in budget section: those with a budget OR with expenses this month
  const budgetCats = EXPENSE_CATEGORIES.filter(c => budgets[c.id] || activeCatIds.has(c.id))

  // ─── Export helpers ───────────────────────────────────────────────────────

  const catLabels = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, t(`cat_${c.id}` as any)]))
  const pmLabels  = Object.fromEntries(PAYMENT_METHODS.map(m => [m.id, t(`pm_${m.id}` as any)]))

  const exportPDF = async () => {
    if (!shop || !expenses.length) return
    setExporting(true)
    try {
      const fmtAmt = (n: number) => fmt(Math.round(n))
      await generateExpensesReportPDF({
        shopName: shop.name,
        month: monthLabel,
        expenses: filtered.map(e => ({
          date:           e.date,
          description:    e.description,
          category:       e.category || 'other',
          payment_method: e.payment_method || 'cash',
          amount:         Number(e.amount),
        })),
        catLabels,
        pmLabels,
        fmtAmt,
        labels: {
          title:       t('pdf_title'),
          colDate:     t('pdf_col_date'),
          colDesc:     t('pdf_col_desc'),
          colCat:      t('pdf_col_cat'),
          colPayment:  t('pdf_col_payment'),
          colAmount:   t('pdf_col_amount'),
          summary:     t('pdf_summary'),
          grandTotal:  t('pdf_grand_total'),
          generatedBy: t('pdf_generated_by'),
          page:        t('pdf_page'),
          of:          t('pdf_of'),
        },
      })
    } catch (err: any) {
      if (err?.name === 'OfflineError') {
        toast({ title: t('no_connection'), description: t('no_connection_download'), variant: 'destructive' })
      } else if (err?.name !== 'AbortError') {
        toast({ title: err.message || t('export_error'), variant: 'destructive' })
      }
    } finally {
      setExporting(false)
    }
  }

  const exportCSV = async () => {
    const header = [t('pdf_col_date'), t('pdf_col_desc'), t('pdf_col_cat'), t('pdf_col_payment'), t('pdf_col_amount')]
    const rows = filtered.map(e => [
      e.date,
      `"${e.description.replace(/"/g, '""')}"`,
      catLabels[e.category || 'other'] || e.category,
      pmLabels[e.payment_method || 'cash'] || e.payment_method,
      String(Number(e.amount)),
    ])
    rows.push(['', '', '', t('pdf_grand_total'), String(total)])
    const csv = [header, ...rows].map(r => r.join(';')).join('\n')
    const filename = `${t('csv_filename_prefix')}-${shop?.name.replace(/\s+/g, '-')}-${monthFilter}.csv`
    try {
      await downloadOrShareCSV(csv, filename)
    } catch (err: any) {
      toast({ title: t('download_error'), variant: 'destructive' })
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setFilter({ monthFilter: format(addMonths(new Date(monthFilter + '-01'), -1), 'yyyy-MM') })}
            aria-label={t('prev_month')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select
            value={monthFilter}
            onValueChange={v => setFilter({ monthFilter: v })}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue>
                {new Date(monthFilter + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => {
                const d = addMonths(new Date(), -i)
                const val = format(d, 'yyyy-MM')
                return (
                  <SelectItem key={val} value={val}>
                    {d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setFilter({ monthFilter: format(addMonths(new Date(monthFilter + '-01'), 1), 'yyyy-MM') })}
            aria-label={t('next_month')}
            disabled={monthFilter >= format(new Date(), 'yyyy-MM')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* Export : menu commun de l'application */}
          {expenses.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9" loading={exporting} aria-label={tA('download')} title={tA('download')}>
                  <FileDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={exportPDF} className="gap-2.5">
                  <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />{t('export_pdf')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV} className="gap-2.5">
                  <Table2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />{t('export_csv')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="stockshop" onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        </div>
      </div>

      {/* View toggle */}
      {isOwnerOrAdmin && (
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setView('expenses')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'expenses' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('tab_expenses')}
          </button>
          <button
            onClick={() => setView('journal')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'journal' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> {t('tab_journal')} {deleteLogs.length > 0 && `(${deleteLogs.length})`}
          </button>
        </div>
      )}

      {view === 'expenses' && (
      <>
      {/* ── Recurring templates ── */}
      {templates.length > 0 && (
        <Card className="border-0 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowTemplates(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4" />
              <span>{t('recurring_section')} ({templates.length})</span>
            </div>
            {showTemplates ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showTemplates && (
            <div className="border-t divide-y">
              {templates.map(tpl => {
                const cat = catFor(tpl.category ?? 'other')
                const nextDate = tpl.next_due_at
                  ? new Date(tpl.next_due_at + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                  : null
                return (
                  <div key={tpl.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={cn('flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-base', cat.color)}>
                      {cat.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tpl.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {tpl.recurrence === 'monthly'
                          ? t('recurrence_monthly_short', { day: tpl.recurrence_day ?? '?' })
                          : t('recurrence_weekly_short')}
                        {nextDate && ` · ${t('next_due')} ${nextDate}`}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-red-600 dark:text-red-400 flex-shrink-0">{fmt(Number(tpl.amount))}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(tpl)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                        loading={deleting === tpl.id}
                        onClick={() => handleDelete(tpl.id, true)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Budget overview ── */}
      {budgetCats.length > 0 && (
        <Card className="border-0 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowBudgets(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Target className="h-4 w-4" />
              <span>{t('budget_section')}</span>
            </div>
            {showBudgets ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showBudgets && (
            <div className="border-t divide-y">
              {budgetCats.map(c => {
                const spent  = catTotals[c.id] ?? 0
                const budget = budgets[c.id] ?? 0
                const pct    = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
                const over   = budget > 0 && spent > budget
                const near   = !over && pct >= 80
                const bar    = over ? 'bg-red-500' : near ? 'bg-orange-400' : 'bg-green-500'

                return (
                  <div key={c.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn('flex-shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-sm', c.color)}>
                          {c.icon}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{t(`cat_${c.id}` as any)}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmt(spent)}
                            {budget > 0 && <span className={cn(over ? 'text-red-500' : near ? 'text-orange-500' : '')}>{` / ${fmt(budget)}`}</span>}
                            {(() => {
                              const pctCat = prevTotals ? trendPct(spent, prevTotals.byCat[c.id]) : null
                              return pctCat === null ? null : (
                                <span className={cn('ml-2 tabular-nums', pctCat > 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400')}>
                                  {pctCat > 0 ? '+' : ''}{pctCat} % {t('vs_last_month')}
                                </span>
                              )
                            })()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {over && <span className="text-xs font-bold text-red-500 animate-pulse">⚠️</span>}
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => openBudgetModal(c.id)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {budget > 0 ? (
                      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
                      </div>
                    ) : (
                      <button
                        onClick={() => openBudgetModal(c.id)}
                        className="text-xs text-stockshop-blue dark:text-blue-400 hover:underline"
                      >
                        + {t('budget_set')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Total + comparaison avec le mois précédent ── */}
      <Card className="border-0 shadow-sm bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Receipt className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-medium truncate">{t('total')} — {monthLabel}</span>
            </div>
            {prevTotals && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="expenses-trend">
                {t('last_month_total', { amount: fmt(prevTotals.total) })}
                {totalTrend !== null && (
                  <span className={cn('ml-2 inline-flex items-center gap-0.5 font-semibold tabular-nums', totalTrend > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                    {totalTrend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {totalTrend > 0 ? '+' : ''}{totalTrend} % {t('vs_last_month')}
                  </span>
                )}
              </p>
            )}
          </div>
          <span className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400 flex-shrink-0">{fmt(total)}</span>
        </CardContent>
      </Card>

      {/* ── Recherche et moyen de paiement ── */}
      {expenses.length > 0 && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search_placeholder')} className="h-9 pl-9" />
          </div>
          <Select value={paymentFilter} onValueChange={v => setFilter({ paymentFilter: v })}>
            <SelectTrigger className="h-9 w-[150px] text-xs" aria-label={t('payment_method_label')} data-testid="expenses-payment-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('payment_filter_all')}</SelectItem>
              {PAYMENT_METHODS.map(m => <SelectItem key={m.id} value={m.id}>{m.icon} {t(`pm_${m.id}` as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── Category filter tabs ── */}
      {expenses.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          <button
            onClick={() => setFilter({ categoryFilter: 'all' })}
            className={cn(
              'flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              categoryFilter === 'all'
                ? 'bg-stockshop-blue text-white border-stockshop-blue dark:border-blue-500'
                : 'bg-background border-border text-muted-foreground hover:border-stockshop-blue/40'
            )}
          >
            {t('filter_all')}
          </button>
          {EXPENSE_CATEGORIES.filter(c => activeCatIds.has(c.id)).map(c => {
            const pct    = budgets[c.id] ? Math.min((catTotals[c.id] / budgets[c.id]) * 100, 999) : -1
            const over   = pct > 100
            const near   = pct >= 80 && pct <= 100
            return (
              <button
                key={c.id}
                onClick={() => setFilter({ categoryFilter: c.id })}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  categoryFilter === c.id
                    ? 'bg-stockshop-blue text-white border-stockshop-blue dark:border-blue-500'
                    : 'bg-background border-border text-muted-foreground hover:border-stockshop-blue/40'
                )}
              >
                <span>{c.icon}</span>
                <span>{t(`cat_${c.id}` as any)}</span>
                {over && <span className="text-red-500">⚠️</span>}
                {near && !over && <span className="text-orange-400">●</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Expense list ── */}
      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filtered.length === 0 && filteredPending.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('none')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Pending (offline) expenses — shown with amber badge until synced */}
          {filteredPending.map(pexp => {
            const cat = catFor(pexp.category)
            return (
              <Card key={pexp.local_id} className="border border-amber-300 dark:border-amber-700 shadow-sm bg-amber-50/60 dark:bg-amber-950/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn('flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-base', cat.color)}>
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">{pexp.description}</p>
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                        <WifiOff className="h-2.5 w-2.5" />
                        hors ligne
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground">
                        {new Date(pexp.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                      </p>
                    </div>
                  </div>
                  <span className="text-base font-bold text-red-600 dark:text-red-400 flex-shrink-0">
                    {fmt(pexp.amount)}
                  </span>
                  <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center text-amber-500">
                    <Clock className="h-4 w-4" aria-label={t('pending_sync_aria')} />
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {/* Dépenses groupées par jour ; un clic sur la ligne ouvre la fiche */}
          {groupedByDay.map(group => (
            <section key={group.key} className="space-y-2" data-testid="expenses-day">
              <div className="flex items-center justify-between px-1 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground first-letter:uppercase">{group.label}</h4>
                <span className="text-xs tabular-nums text-muted-foreground" title={t('day_total')}>{fmt(group.total)}</span>
              </div>
              {group.items.map(exp => {
                const cat = catFor(exp.category ?? 'other')
                const pm  = exp.payment_method
                return (
                  <Card key={exp.id} className="border-0 shadow-sm" data-testid="expense-row">
                    <CardContent className="p-0 flex items-center">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40 rounded-l-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => setDetailExpense(exp)}
                      >
                        <div className={cn('flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-base', cat.color)}>
                          {cat.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium truncate">{exp.description}</p>
                            {exp.template_id && (
                              <RefreshCw className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" aria-label={t('recurring_generated_label')} />
                            )}
                            {exp.receipt_url && <Paperclip className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" aria-label={t('receipt_label')} />}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-muted-foreground">{t(`cat_${cat.id}` as any)}</p>
                            {pm && pm !== 'cash' && (
                              <span className={cn(
                                'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                                pm === 'mobile_money'
                                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                                  : 'bg-stockshop-blue-muted dark:bg-blue-900/40 text-stockshop-blue dark:text-blue-300'
                              )}>
                                {PAYMENT_METHODS.find(m => m.id === pm)?.icon} {t(`pm_${pm}` as any)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-base font-bold tabular-nums text-red-600 dark:text-red-400 flex-shrink-0">
                          {fmt(Number(exp.amount))}
                        </span>
                      </button>
                      <div className="flex gap-1 flex-shrink-0 items-center pr-3">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={tA('edit')} onClick={() => openEdit(exp)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {canDeleteExpenses && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                            loading={deleting === exp.id}
                            aria-label={tA('delete')}
                            onClick={() => handleDelete(exp.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </section>
          ))}
        </div>
      )}
      </>
      )}

      {/* ── Journal des suppressions (owner uniquement) ── */}
      {view === 'journal' && isOwnerOrAdmin && (
        <Card className="border-0 shadow-sm overflow-hidden">
          {deleteLogs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">{t('delete_journal_empty')}</p>
          ) : (
            <div className="divide-y">
              {deleteLogs.map(log => {
                const cat = catFor(log.metadata?.category ?? 'other')
                const dateStr = new Date(log.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={cn('flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-base', cat.color)}>
                      {cat.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{log.metadata?.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('deleted_by')} <span className="font-medium text-foreground">{log.actor_email}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{dateStr}</p>
                    </div>
                    <span className="text-sm font-semibold text-red-500 flex-shrink-0">
                      -{fmt(Number(log.metadata?.amount))}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Nouvelle dépense / modification : panneau à sections ── */}
      <FormDrawer
        open={modalOpen}
        onOpenChange={open => { if (!open) setModalOpen(false) }}
        title={editing ? t('edit_title') : t('new_title')}
        description={editing?.description}
        icon={<Receipt className="h-4 w-4" />}
        width="md"
        onSubmit={handleSave}
        submitting={saving}
        submitDisabled={!amount || !description.trim() || (!isReallyOnline && (!!editing || isRecurring))}
        submitLabel={editing ? t('save') : !isReallyOnline ? t('add_offline_button') : t('add')}
        submitIcon={editing ? undefined : <Plus className="h-4 w-4" />}
        dirty={formDirty}
        testId="expense-drawer"
        footerExtra={!isReallyOnline && (editing || isRecurring) ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <WifiOff className="h-4 w-4 flex-shrink-0" />
            <span>{editing ? t('edit_requires_connection') : t('recurring_requires_connection')}</span>
          </div>
        ) : undefined}
      >
        <DrawerSection title={t('section_amount')}>
          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">{t('amount')}<RequiredMark /></Label>
            <InputGroup suffix={symbol}>
              <NumericInput
                id="expense-amount"
                name="amount"
                value={amount}
                onChange={v => setAmount(String(v))}
                placeholder="0"
                currency={shop?.currency || 'XOF'}
                className="h-10 text-lg font-semibold"
              />
            </InputGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-description">{t('description')}<RequiredMark /></Label>
            <Input
              id="expense-description"
              name="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('description_placeholder')}
            />
          </div>
        </DrawerSection>

        <DrawerSection title={t('section_category')}>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t('category_label')}>
            {EXPENSE_CATEGORIES.map(c => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={category === c.id}
                onClick={() => {
                  // Pre-fill the description with the category name, but only if
                  // it's still empty or untouched (equal to the previous category's
                  // default label) — never overwrite text the user typed themselves.
                  const previousDefault = t(`cat_${category}` as any)
                  if (!description.trim() || description === previousDefault) {
                    setDescription(t(`cat_${c.id}` as any))
                  }
                  setCategory(c.id)
                }}
                title={t(`cat_${c.id}` as any)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2 text-[10px] transition-all leading-tight',
                  category === c.id
                    ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400'
                    : 'border-border hover:border-stockshop-blue/40 text-muted-foreground'
                )}
              >
                <span className="text-lg leading-none">{c.icon}</span>
                <span className="truncate w-full text-center">{t(`cat_${c.id}` as any)}</span>
              </button>
            ))}
          </div>
        </DrawerSection>

        <DrawerSection title={t('section_payment')}>
          <div className="space-y-1.5">
            <Label>{t('payment_method_label')}</Label>
            <div className="flex gap-2" role="radiogroup" aria-label={t('payment_method_label')}>
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={paymentMethod === m.id}
                  onClick={() => setPaymentMethod(m.id)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1 rounded-xl border-2 py-2.5 text-[10px] font-medium transition-all',
                    paymentMethod === m.id
                      ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400'
                      : 'border-border text-muted-foreground hover:border-stockshop-blue/40'
                  )}
                >
                  <span className="text-lg leading-none">{m.icon}</span>
                  <span>{t(`pm_${m.id}` as any)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-date">{t('date')}</Label>
            <Input id="expense-date" name="date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </DrawerSection>

        <DrawerSection title={t('section_receipt')}>
          {receiptPreview ? (
            <div className="relative rounded-xl border overflow-hidden bg-muted/30">
              {receiptPreview.match(/\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/i) || (receiptFile && receiptFile.type.startsWith('image/')) ? (
                <img src={receiptPreview} alt="justificatif" className="w-full max-h-40 object-cover" />
              ) : (
                <div className="flex items-center gap-2 px-3 py-3">
                  <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">
                    {receiptFile?.name ?? t('receipt_label')}
                  </span>
                </div>
              )}
              <button
                type="button"
                aria-label={tA('remove')}
                onClick={() => { setReceiptFile(null); setReceiptPreview(null) }}
                className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <X className="h-3.5 w-3.5 text-white" />
              </button>
              {!receiptFile && receiptPreview && (
                <a
                  href={receiptPreview}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-1.5 right-1.5 h-6 px-2 rounded-full bg-black/50 flex items-center gap-1 text-[10px] text-white hover:bg-black/70 transition-colors"
                >
                  <Paperclip className="h-3 w-3" /> {tA('view')}
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => pickReceipt('camera')}
                  className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border px-3 py-3.5 text-muted-foreground hover:border-stockshop-blue/50 hover:bg-muted/30 hover:text-foreground transition-colors"
                >
                  <Camera className="h-5 w-5" />
                  <span className="text-xs">{t('receipt_take_photo')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => pickReceipt('file')}
                  className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border px-3 py-3.5 text-muted-foreground hover:border-stockshop-blue/50 hover:bg-muted/30 hover:text-foreground transition-colors"
                >
                  <Paperclip className="h-5 w-5" />
                  <span className="text-xs">{t('receipt_choose_file')}</span>
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('receipt_placeholder')}</p>
              {/* Web : caméra du téléphone (sur ordinateur, sélecteur de fichier) */}
              <input ref={receiptCameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onReceiptInput} />
              {/* Web et natif : fichier image ou PDF via le sélecteur système */}
              <input ref={receiptFileRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={onReceiptInput} />
            </div>
          )}
        </DrawerSection>

        <DrawerSection title={t('section_recurrence')}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('recurring_label')}</p>
              <p className="text-xs text-muted-foreground">{t('recurring_desc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isRecurring}
              aria-label={t('recurring_label')}
              onClick={() => setIsRecurring(v => !v)}
              className={cn(
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                isRecurring ? 'bg-stockshop-blue' : 'bg-muted'
              )}
            >
              <span className={cn(
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                isRecurring ? 'translate-x-5' : 'translate-x-0'
              )} />
            </button>
          </div>
          {isRecurring && (
            <div className="space-y-3 rounded-xl bg-muted/40 border p-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t('recurrence_frequency')}</p>
                <div className="flex gap-2">
                  {(['monthly', 'weekly'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRecurrence(r)}
                      aria-pressed={recurrence === r}
                      className={cn(
                        'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                        recurrence === r
                          ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400'
                          : 'border-border text-muted-foreground hover:border-stockshop-blue/40'
                      )}
                    >
                      {r === 'monthly' ? t('recurrence_monthly') : t('recurrence_weekly')}
                    </button>
                  ))}
                </div>
              </div>
              {recurrence === 'monthly' && (
                <div className="space-y-1.5">
                  <Label htmlFor="expense-recurrence-day" className="text-xs font-medium text-muted-foreground">{t('recurrence_day')}</Label>
                  <select
                    id="expense-recurrence-day"
                    value={recurrenceDay}
                    onChange={e => setRecurrenceDay(Number(e.target.value))}
                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{t('day_of_month', { day: d })}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </DrawerSection>
      </FormDrawer>

      {/* ── Budget d'une catégorie : un montant → modale ── */}
      <PremiumDialog
        open={budgetModalOpen}
        onOpenChange={open => { if (!open) setBudgetModalOpen(false) }}
        category={t('budget_section')}
        title={`${catFor(budgetCategory).icon} ${t(`cat_${budgetCategory}` as any)}`}
        icon={<Target className="h-4 w-4" />}
        maxWidth="max-w-md"
        dirty={budgetAmount !== (budgets[budgetCategory] ? String(budgets[budgetCategory]) : '')}
        testId="budget-dialog"
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="budget-amount">{t('budget_amount')}</Label>
            <InputGroup suffix={symbol}>
              <NumericInput
                id="budget-amount"
                value={budgetAmount}
                onChange={v => setBudgetAmount(String(v))}
                placeholder="0"
                currency={shop?.currency || 'XOF'}
                className="h-10 text-lg font-semibold"
              />
            </InputGroup>
          </div>
          {budgets[budgetCategory] && (
            <p className="text-xs text-muted-foreground">
              {t('total')} {monthLabel} : <span className="font-medium">{fmt(catTotals[budgetCategory] ?? 0)}</span>
            </p>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setBudgetModalOpen(false)}
          onConfirm={saveBudget}
          confirmLabel={t('save')}
          confirmLoading={savingBudget}
          confirmDisabled={!budgetAmount || savingBudget}
          confirmIcon={<Save className="h-4 w-4" />}
        >
          {budgets[budgetCategory] && (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-0 rounded-lg border-red-200 px-3 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
              onClick={() => setDeleteBudgetConfirm(true)}
              data-testid="budget-delete"
            >
              <Trash2 className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">{t('budget_delete')}</span>
            </Button>
          )}
        </PremiumDialogFooter>
      </PremiumDialog>

      <ConfirmModal
        open={deleteBudgetConfirm}
        onOpenChange={open => { if (!open && !deletingBudget) setDeleteBudgetConfirm(false) }}
        title={t('budget_delete_confirm')}
        description={t('delete_budget_hint')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('budget_delete')}
        loading={deletingBudget}
        onConfirm={deleteBudget}
      />

      {/* ── Suppression d'une dépense ou d'une dépense récurrente ── */}
      <ConfirmModal
        open={deleteDialog.open}
        onOpenChange={open => { if (!open) setDeleteDialog({ open: false, id: null, isTemplate: false }) }}
        title={t(deleteDialog.isTemplate ? 'recurring_delete_confirm' : 'delete_confirm')}
        description={t('delete_warning')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={tA('delete')}
        loading={!!deleteDialog.id && deleting === deleteDialog.id}
        onConfirm={confirmDelete}
      />

      {/* ── Fiche d'une dépense : justificatif, détails, Dupliquer / Modifier / Supprimer ── */}
      <DetailDrawer
        open={!!detailExpense}
        onOpenChange={open => { if (!open) setDetailExpense(null) }}
        title={detailExpense?.description || ''}
        description={detailExpense ? new Date(detailExpense.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : undefined}
        icon={<Receipt className="h-4 w-4" />}
        width="md"
        testId="expense-sheet"
        meta={detailExpense ? (() => {
          const cat = catFor(detailExpense.category ?? 'other')
          return (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-base', cat.color)}>{cat.icon}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t(`cat_${cat.id}` as any)}</p>
                  <p className="text-xs text-muted-foreground">{PAYMENT_METHODS.find(m => m.id === detailExpense.payment_method)?.icon} {t(`pm_${detailExpense.payment_method || 'cash'}` as any)}</p>
                </div>
              </div>
              <span className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{fmt(Number(detailExpense.amount))}</span>
            </div>
          )
        })() : undefined}
        actions={detailExpense ? (
          <div className={FOOTER_ROW_CLASS}>
            {canDeleteExpenses && (
              <Button
                type="button"
                variant="outline"
                className="h-11 min-w-0 rounded-lg border-red-200 px-3 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
                aria-label={tA('delete')}
                onClick={() => { const id = detailExpense.id; setDetailExpense(null); handleDelete(id) }}
              >
                <Trash2 className="h-4 w-4" />
                <span className="ml-1.5 hidden sm:inline">{tA('delete')}</span>
              </Button>
            )}
            <Button type="button" variant="outline" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-4 sm:flex-none" onClick={() => openDuplicate(detailExpense)} data-testid="expense-duplicate">
              <Copy className="h-4 w-4" />{t('duplicate')}
            </Button>
            <Button type="button" variant="stockshop" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-5 font-semibold sm:flex-none sm:min-w-[140px]" onClick={() => { const exp = detailExpense; setDetailExpense(null); openEdit(exp) }} data-testid="expense-edit">
              <Pencil className="h-4 w-4" />{tA('edit')}
            </Button>
          </div>
        ) : undefined}
      >
        {detailExpense && (
          <div className="space-y-4">
            <DrawerSection title={t('section_receipt')}>
              {detailExpense.receipt_url ? (
                <div className="space-y-2">
                  {/\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/i.test(detailExpense.receipt_url) ? (
                    <a href={detailExpense.receipt_url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border bg-muted/30">
                      <img src={detailExpense.receipt_url} alt="justificatif" className="max-h-80 w-full object-contain" />
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-3">
                      <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm text-muted-foreground">PDF</span>
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                    <a href={detailExpense.receipt_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />{t('receipt_open')}</a>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('no_receipt')}</p>
              )}
            </DrawerSection>
            <DrawerSection title={t('details')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('date')}</dt>
                <dd>{new Date(detailExpense.date + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
                <dt className="text-muted-foreground">{t('category_label')}</dt>
                <dd>{t(`cat_${detailExpense.category || 'other'}` as any)}</dd>
                <dt className="text-muted-foreground">{t('payment_method_label')}</dt>
                <dd>{t(`pm_${detailExpense.payment_method || 'cash'}` as any)}</dd>
                <dt className="text-muted-foreground">{t('amount')}</dt>
                <dd className="font-semibold tabular-nums">{fmt(Number(detailExpense.amount))}</dd>
              </dl>
              {detailExpense.template_id && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" />{t('source_recurring')}</p>
              )}
            </DrawerSection>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
