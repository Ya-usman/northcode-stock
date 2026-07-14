'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Plus, Pencil, Trash2, Receipt, RefreshCw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Target, FileDown, FileText, Table2, Camera, Paperclip, X, WifiOff, Clock, AlertTriangle } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrency } from '@/lib/hooks/use-currency'
import { NumericInput } from '@/components/ui/numeric-input'
import { format, startOfMonth, endOfMonth, addMonths, addWeeks } from 'date-fns'
import type { Expense, ExpenseBudget } from '@/lib/types/database'
import { setPageCache, getPageCache, getPageCacheAge } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { savePendingExpense, getPendingExpenses, type PendingExpense } from '@/lib/offline/db'

import { cn } from '@/lib/utils/cn'
import { withTimeout } from '@/lib/utils/with-timeout'
import { generateExpensesReportPDF } from '@/lib/utils/pdf'
import { downloadOrShareCSV } from '@/lib/utils/native-share'

const supabase = createClient() as any

const EXPENSE_CATEGORIES = [
  { id: 'rent',        icon: '🏠', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
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
  const { shop, effectiveShopIds, profile } = useAuth()
  const [{ monthFilter, categoryFilter }, setFilter] = usePersistedFilters(
    'expenses', shop?.id, { monthFilter: format(new Date(), 'yyyy-MM'), categoryFilter: 'all' }
  )
  const { toast } = useToast()
  const { fmt } = useCurrency()
  const t = useTranslations('expenses')
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

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
    if (!isReallyOnline) return
    const start = startOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    const end   = endOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    try {
      const [{ data: expData, error: expErr }, { data: tplData }] = await Promise.all([
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
      ])
      if (expErr) {
        toast({ title: expErr.message, variant: 'destructive' })
        return
      }
      setExpenses((expData || []) as Expense[])
      setTemplates((tplData || []) as Expense[])
      setPageCache(cacheKey, expData || [])
    } catch (err: any) {
      toast({ title: err.message || 'Erreur chargement', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [shopIdsKey, monthFilter, isReallyOnline])

  const fetchBudgets = useCallback(async () => {
    if (!shop?.id || !isReallyOnline) return
    const { data } = await supabase
      .from('expense_budgets')
      .select('category, amount')
      .eq('shop_id', shop.id)
    if (!data) return
    const map: Record<string, number> = {}
    ;(data as ExpenseBudget[]).forEach(b => { map[b.category] = Number(b.amount) })
    setBudgets(map)
  }, [shop?.id, isReallyOnline])

  const isOwnerOrAdmin = profile?.role === 'owner' || profile?.role === 'super_admin'

  const fetchDeleteLogs = useCallback(async () => {
    if (!shop?.id || !isOwnerOrAdmin || !isReallyOnline) return
    const { data } = await supabase
      .from('audit_logs')
      .select('id, created_at, actor_email, metadata')
      .eq('shop_id', shop.id)
      .eq('action', 'expense.delete')
      .order('created_at', { ascending: false })
      .limit(50)
    setDeleteLogs((data || []) as DeleteLog[])
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
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshExpensesData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshExpensesData])
  useRefetchOnReconnect(refreshExpensesData, isReallyOnline)

  // ─── Expense CRUD ────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditing(null)
    setAmount('')
    setDescription('')
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setCategory('other')
    setPaymentMethod('cash')
    setIsRecurring(false)
    setRecurrence('monthly')
    setRecurrenceDay(Math.min(new Date().getDate(), 28))
    setReceiptFile(null)
    setReceiptPreview(null)
    supabase.auth.getSession().catch(() => {})
    setModalOpen(true)
  }

  const openEdit = (exp: Expense) => {
    setEditing(exp)
    setAmount(String(exp.amount))
    setDescription(exp.description)
    setDate(exp.date)
    setCategory((exp.category as CategoryId) || 'other')
    setPaymentMethod(exp.payment_method ?? 'cash')
    setIsRecurring(exp.is_recurring ?? false)
    setRecurrence(exp.recurrence ?? 'monthly')
    setRecurrenceDay(exp.recurrence_day ?? 1)
    setReceiptFile(null)
    setReceiptPreview(exp.receipt_url ?? null)
    supabase.auth.getSession().catch(() => {})
    setModalOpen(true)
  }

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
        toast({ title: `${t('added')} · sera synchronisé à la reconnexion`, variant: 'success' })
        setModalOpen(false)
      } catch (err: any) {
        toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
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
        const currency = shop?.currency || 'XOF'
        const isNGN = currency === 'NGN'
        const amountStr = isNGN
          ? `NGN ${Number(amount).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`
          : `${Number(amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`
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
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
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
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
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
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSavingBudget(false)
    }
  }

  const deleteBudget = async () => {
    if (!shop?.id || !confirm(t('budget_delete_confirm'))) return
    await withTimeout(supabase.from('expense_budgets').delete().eq('shop_id', shop.id).eq('category', budgetCategory))
    toast({ title: t('budget_deleted'), variant: 'success' })
    setBudgetModalOpen(false)
    setBudgets(prev => { const n = { ...prev }; delete n[budgetCategory]; return n })
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const filtered   = expenses.filter(e => categoryFilter === 'all' || (e.category || 'other') === categoryFilter)
  const filteredPending = pendingExpenses.filter(p =>
    p.date.slice(0, 7) === monthFilter &&
    (categoryFilter === 'all' || p.category === categoryFilter)
  )
  const total      = filtered.reduce((s, e) => s + Number(e.amount), 0)
                   + filteredPending.reduce((s, p) => s + p.amount, 0)
  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

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
    setExportMenuOpen(false)
    try {
      const currency = shop.currency || 'XOF'
      const isNGN = currency === 'NGN'
      const fmtAmt = (n: number) => isNGN
        ? `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`
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
        toast({ title: 'Pas de connexion', description: 'Connectez-vous pour télécharger.', variant: 'destructive' })
      } else if (err?.name !== 'AbortError') {
        toast({ title: err.message || 'Erreur export', variant: 'destructive' })
      }
    } finally {
      setExporting(false)
    }
  }

  const exportCSV = async () => {
    setExportMenuOpen(false)
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
      toast({ title: 'Erreur de téléchargement', variant: 'destructive' })
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
            aria-label="Mois précédent"
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
            aria-label="Mois suivant"
            disabled={monthFilter >= format(new Date(), 'yyyy-MM')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* Export dropdown */}
          {expenses.length > 0 && (
            <div className="relative">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                loading={exporting}
                onClick={() => setExportMenuOpen(v => !v)}
                aria-label="Exporter"
              >
                <FileDown className="h-4 w-4" />
              </Button>
              {exportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-50 w-44 rounded-xl border bg-background shadow-lg p-1 flex flex-col gap-0.5">
                    <button
                      onClick={exportPDF}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
                    >
                      <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <span>{t('export_pdf')}</span>
                    </button>
                    <button
                      onClick={exportCSV}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
                    >
                      <Table2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span>{t('export_csv')}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
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
                        className="text-xs text-stockshop-blue hover:underline"
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

      {/* ── Total ── */}
      <Card className="border-0 shadow-sm bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <Receipt className="h-5 w-5" />
            <span className="text-sm font-medium">{t('total')} — {monthLabel}</span>
          </div>
          <span className="text-xl font-bold text-red-600 dark:text-red-400">{fmt(total)}</span>
        </CardContent>
      </Card>

      {/* ── Category filter tabs ── */}
      {expenses.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          <button
            onClick={() => setFilter({ categoryFilter: 'all' })}
            className={cn(
              'flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              categoryFilter === 'all'
                ? 'bg-stockshop-blue text-white border-stockshop-blue'
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
                    ? 'bg-stockshop-blue text-white border-stockshop-blue'
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
      {loading ? (
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
                    <Clock className="h-4 w-4" aria-label="En attente de synchronisation" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {filtered.map(exp => {
            const cat = catFor(exp.category ?? 'other')
            const pm  = exp.payment_method
            return (
              <Card key={exp.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn('flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-base', cat.color)}>
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium truncate">{exp.description}</p>
                      {exp.template_id && (
                        <RefreshCw className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" aria-label={t('recurring_generated_label')} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground">
                        {new Date(exp.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                      </p>
                      {pm && pm !== 'cash' && (
                        <span className={cn(
                          'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                          pm === 'mobile_money'
                            ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        )}>
                          {PAYMENT_METHODS.find(m => m.id === pm)?.icon} {t(`pm_${pm}` as any)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-base font-bold text-red-600 dark:text-red-400 flex-shrink-0">
                    {fmt(Number(exp.amount))}
                  </span>
                  <div className="flex gap-1 flex-shrink-0 items-center">
                    {exp.receipt_url && (
                      <a
                        href={exp.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                        title={t('receipt_label')}
                      >
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      </a>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(exp)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                      loading={deleting === exp.id}
                      onClick={() => handleDelete(exp.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
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

      {/* ── Expense modal ── */}
      <PremiumDialog
        open={modalOpen}
        onOpenChange={open => { if (!open) setModalOpen(false) }}
        category={t('category')}
        title={editing ? t('edit_title') : t('new_title')}
        icon={<Receipt className="h-5 w-5" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1">
            <Label>{t('amount')}</Label>
            <NumericInput
              value={amount}
              onChange={v => setAmount(String(v))}
              placeholder="0"
              currency={shop?.currency || 'XOF'}
              className="text-lg font-semibold"
            />
          </div>

          <div className="space-y-1">
            <Label>{t('description')}</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('description_placeholder')}
            />
          </div>

          {/* Category picker */}
          <div className="space-y-2">
            <Label>{t('category_label')}</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {EXPENSE_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  type="button"
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
                      ? 'border-stockshop-blue bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400 scale-105'
                      : 'border-border hover:border-stockshop-blue/40 text-muted-foreground'
                  )}
                >
                  <span className="text-lg leading-none">{c.icon}</span>
                  <span className="truncate w-full text-center">{t(`cat_${c.id}` as any)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>{t('payment_method_label')}</Label>
            <div className="flex gap-2">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1 rounded-xl border-2 py-2.5 text-[10px] font-medium transition-all',
                    paymentMethod === m.id
                      ? 'border-stockshop-blue bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400'
                      : 'border-border text-muted-foreground hover:border-stockshop-blue/40'
                  )}
                >
                  <span className="text-lg leading-none">{m.icon}</span>
                  <span>{t(`pm_${m.id}` as any)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('date')}</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {/* Receipt / justificatif */}
          <div className="space-y-1.5">
            <Label>{t('receipt_label')}</Label>
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
                    <Paperclip className="h-3 w-3" /> Voir
                  </a>
                )}
              </div>
            ) : (
              <label className="cursor-pointer flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-4 hover:border-stockshop-blue/50 hover:bg-muted/30 transition-colors">
                <Camera className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground">{t('receipt_placeholder')}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="sr-only"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setReceiptFile(file)
                    setReceiptPreview(URL.createObjectURL(file))
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>

          {/* Recurring toggle */}
          <div className="flex items-center justify-between rounded-xl border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t('recurring_label')}</p>
              <p className="text-xs text-muted-foreground">{t('recurring_desc')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isRecurring}
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
                      className={cn(
                        'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                        recurrence === r
                          ? 'border-stockshop-blue bg-stockshop-blue/10 text-stockshop-blue dark:text-blue-400'
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
                  <p className="text-xs font-medium text-muted-foreground">{t('recurrence_day')}</p>
                  <select
                    value={recurrenceDay}
                    onChange={e => setRecurrenceDay(Number(e.target.value))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{t('day_of_month', { day: d })}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </PremiumDialogBody>
        {!isReallyOnline && (editing || isRecurring) && (
          <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300">
            <WifiOff className="h-4 w-4 flex-shrink-0" />
            <span>{editing ? 'La modification nécessite une connexion internet.' : 'Les dépenses récurrentes nécessitent une connexion internet.'}</span>
          </div>
        )}
        <PremiumDialogFooter onCancel={() => setModalOpen(false)}>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!amount || !description.trim() || saving || (!isReallyOnline && (!!editing || isRecurring))}
            variant="stockshop"
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {editing ? t('save') : !isReallyOnline ? `${t('add')} (hors ligne)` : t('add')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

      {/* ── Budget modal ── */}
      <PremiumDialog
        open={budgetModalOpen}
        onOpenChange={open => { if (!open) setBudgetModalOpen(false) }}
        category={t('budget_section')}
        title={`${catFor(budgetCategory).icon} ${t(`cat_${budgetCategory}` as any)}`}
        icon={<Target className="h-5 w-5" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1">
            <Label>{t('budget_amount')}</Label>
            <NumericInput
              value={budgetAmount}
              onChange={v => setBudgetAmount(String(v))}
              placeholder="0"
              currency={shop?.currency || 'XOF'}
              className="text-lg font-semibold"
            />
          </div>
          {budgets[budgetCategory] && (
            <p className="text-xs text-muted-foreground">
              {t('total')} {monthLabel} : <span className="font-medium">{fmt(catTotals[budgetCategory] ?? 0)}</span>
            </p>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setBudgetModalOpen(false)}>
          {budgets[budgetCategory] && (
            <Button
              type="button"
              variant="ghost"
              className="flex-1 h-11 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-200 dark:border-red-800"
              onClick={deleteBudget}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {t('budget_delete')}
            </Button>
          )}
          <Button
            onClick={saveBudget}
            loading={savingBudget}
            disabled={!budgetAmount || savingBudget}
            variant="stockshop"
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {t('save')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

      {/* ── Delete confirmation modal ── */}
      <PremiumDialog
        open={deleteDialog.open}
        onOpenChange={open => { if (!open) setDeleteDialog({ open: false, id: null, isTemplate: false }) }}
        category={t('category')}
        title={t(deleteDialog.isTemplate ? 'recurring_delete_confirm' : 'delete_confirm')}
        icon={<Trash2 className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 p-3">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{t('delete_warning')}</p>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDeleteDialog({ open: false, id: null, isTemplate: false })}
          cancelLabel={tA('cancel')}
          onConfirm={confirmDelete}
          confirmLabel={tA('delete')}
          confirmDisabled={deleting === deleteDialog.id}
          confirmLoading={deleting === deleteDialog.id}
          confirmDestructive
        />
      </PremiumDialog>
    </div>
  )
}
