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
import { Plus, Pencil, Trash2, Receipt, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { useCurrency } from '@/lib/hooks/use-currency'
import { NumericInput } from '@/components/ui/numeric-input'
import { format, startOfMonth, endOfMonth, addMonths, addWeeks } from 'date-fns'
import type { Expense } from '@/lib/types/database'
import { setPageCache, getPageCache, getPageCacheAge } from '@/lib/offline/page-cache'
import { CacheBanner } from '@/components/layout/cache-banner'
import { cn } from '@/lib/utils/cn'

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
  const { shop, effectiveShopIds } = useAuth()
  const [{ monthFilter, categoryFilter }, setFilter] = usePersistedFilters(
    'expenses', shop?.id, { monthFilter: format(new Date(), 'yyyy-MM'), categoryFilter: 'all' }
  )
  const { toast } = useToast()
  const { fmt } = useCurrency()
  const t = useTranslations('expenses')

  const [expenses, setExpenses]     = useState<Expense[]>([])
  const [templates, setTemplates]   = useState<Expense[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(true)

  const [isOnline, setIsOnline]     = useState(true)
  const [cacheAge, setCacheAge]     = useState<number | null>(null)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<Expense | null>(null)

  // Form state
  const [amount, setAmount]           = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate]               = useState(format(new Date(), 'yyyy-MM-dd'))
  const [category, setCategory]       = useState<CategoryId>('other')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrence, setRecurrence]   = useState<'monthly' | 'weekly'>('monthly')
  const [recurrenceDay, setRecurrenceDay] = useState(1)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const withTimeout = useCallback((p: Promise<any>, ms = 8_000) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connexion trop lente — réessayez.')), ms))]),
  [])

  const shopIdsKey = effectiveShopIds.join(',')

  const fetchExpenses = useCallback(async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `expenses_${shopIdsKey}_${monthFilter}`
    const cached = getPageCache<Expense[]>(cacheKey)
    if (cached) {
      setExpenses(cached)
      setCacheAge(getPageCacheAge(cacheKey))
      setLoading(false)
    } else {
      setLoading(true)
    }
    if (!navigator.onLine) return
    const start = startOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    const end   = endOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    try {
      const [{ data: expData }, { data: tplData }] = await Promise.all([
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
      setExpenses((expData || []) as Expense[])
      setTemplates((tplData || []) as Expense[])
      setPageCache(cacheKey, expData || [])
      setCacheAge(null)
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }, [shopIdsKey, monthFilter])

  const generateDueRecurring = useCallback(async () => {
    if (!effectiveShopIds.length || !navigator.onLine) return
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
          shop_id:     tpl.shop_id,
          amount:      tpl.amount,
          description: tpl.description,
          category:    tpl.category ?? 'other',
          date:        dueDate,
          is_recurring: false,
          template_id: tpl.id,
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
    }
  }, [shopIdsKey, fetchExpenses])

  useEffect(() => {
    fetchExpenses()
    generateDueRecurring()
  }, [shopIdsKey, monthFilter])

  const openAdd = () => {
    setEditing(null)
    setAmount('')
    setDescription('')
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setCategory('other')
    setIsRecurring(false)
    setRecurrence('monthly')
    setRecurrenceDay(Math.min(new Date().getDate(), 28))
    setModalOpen(true)
  }

  const openEdit = (exp: Expense) => {
    setEditing(exp)
    setAmount(String(exp.amount))
    setDescription(exp.description)
    setDate(exp.date)
    setCategory((exp.category as CategoryId) || 'other')
    setIsRecurring(exp.is_recurring ?? false)
    setRecurrence(exp.recurrence ?? 'monthly')
    setRecurrenceDay(exp.recurrence_day ?? 1)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!shop?.id || !amount || !description.trim()) return
    setSaving(true)
    const payload: Partial<Expense> & { shop_id: string } = {
      shop_id:       shop.id,
      amount:        Number(amount),
      description:   description.trim(),
      date,
      category,
      is_recurring:  isRecurring,
      recurrence:    isRecurring ? recurrence : null,
      recurrence_day: isRecurring && recurrence === 'monthly' ? recurrenceDay : null,
      next_due_at:   isRecurring ? date : null,
      template_id:   null,
    }
    try {
      let error: any = null
      if (editing) {
        ;({ error } = await withTimeout(
          supabase.from('expenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
        ))
      } else {
        ;({ error } = await withTimeout(supabase.from('expenses').insert(payload)))
      }
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: editing ? t('updated') : (isRecurring ? t('recurring_added') : t('added')), variant: 'success' })
      setModalOpen(false)
      fetchExpenses()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, isTemplate = false) => {
    if (!confirm(isTemplate ? t('recurring_delete_confirm') : t('delete_confirm'))) return
    setDeleting(id)
    try {
      const { error } = await withTimeout(supabase.from('expenses').delete().eq('id', id))
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: t('deleted'), variant: 'success' })
      fetchExpenses()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  const filtered    = expenses.filter(e => categoryFilter === 'all' || e.category === categoryFilter)
  const total       = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const monthLabel  = new Date(monthFilter + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  // Only show category filter tabs for categories that have entries this month
  const activeCatIds = new Set(expenses.map(e => e.category || 'other'))
  const catTotals = Object.fromEntries(
    EXPENSE_CATEGORIES.map(c => [c.id, expenses.filter(e => (e.category || 'other') === c.id).reduce((s, e) => s + Number(e.amount), 0)])
  )

  return (
    <div className="space-y-4 max-w-2xl">
      <CacheBanner ageMs={cacheAge} isOnline={isOnline} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input
          type="month"
          value={monthFilter}
          onChange={e => setFilter({ monthFilter: e.target.value })}
          className="rounded-lg border px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-stockshop-blue"
        />
        <Button onClick={openAdd} className="bg-stockshop-blue hover:bg-stockshop-blue-light text-white gap-2">
          <Plus className="h-4 w-4" />
          {t('add')}
        </Button>
      </div>

      {/* Recurring templates */}
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
            {showTemplates
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
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

      {/* Total */}
      <Card className="border-0 shadow-sm bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <Receipt className="h-5 w-5" />
            <span className="text-sm font-medium">{t('total')} — {monthLabel}</span>
          </div>
          <span className="text-xl font-bold text-red-600 dark:text-red-400">{fmt(total)}</span>
        </CardContent>
      </Card>

      {/* Category filter tabs */}
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
          {EXPENSE_CATEGORIES.filter(c => activeCatIds.has(c.id)).map(c => (
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
              <span className="opacity-70">{fmt(catTotals[c.id])}</span>
            </button>
          ))}
        </div>
      )}

      {/* Expense list */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('none')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(exp => {
            const cat = catFor(exp.category ?? 'other')
            return (
              <Card key={exp.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn('flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-base', cat.color)}>
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{exp.description}</p>
                      {exp.template_id && (
                        <RefreshCw className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" aria-label={t('recurring_generated_label')} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(exp.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                    </p>
                  </div>
                  <span className="text-base font-bold text-red-600 dark:text-red-400 flex-shrink-0">
                    {fmt(Number(exp.amount))}
                  </span>
                  <div className="flex gap-1 flex-shrink-0">
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

      {/* Modal */}
      <PremiumDialog
        open={modalOpen}
        onOpenChange={open => { if (!open) setModalOpen(false) }}
        category={t('category')}
        title={editing ? t('edit_title') : t('new_title')}
        icon={<Receipt className="h-5 w-5" />}
      >
        <PremiumDialogBody>
          {/* Amount */}
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

          {/* Description */}
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
                  onClick={() => setCategory(c.id)}
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

          {/* Date */}
          <div className="space-y-1">
            <Label>{t('date')}</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
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
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                  isRecurring ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Recurrence options */}
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
        <PremiumDialogFooter onCancel={() => setModalOpen(false)}>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!amount || !description.trim() || saving}
            className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light text-white"
          >
            {editing ? t('save') : t('add')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}
