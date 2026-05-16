'use client'

import { useState, useEffect } from 'react'
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
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react'
import { useCurrency } from '@/lib/hooks/use-currency'
import { NumericInput } from '@/components/ui/numeric-input'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import type { Expense } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'

const supabase = createClient() as any

export default function ExpensesPage() {
  const { shop, effectiveShopIds } = useAuth()
  const [{ monthFilter }, setFilter] = usePersistedFilters(
    'expenses', shop?.id, { monthFilter: format(new Date(), 'yyyy-MM') }
  )
  const { toast } = useToast()
  const { fmt } = useCurrency()
  const t = useTranslations('expenses')

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))


  const fetchExpenses = async () => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const cacheKey = `expenses_${effectiveShopIds.join(',')}_${monthFilter}`
    const start = startOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    const end = endOfMonth(new Date(monthFilter + '-01')).toISOString().slice(0, 10)
    try {
      const { data } = await supabase
        .from('expenses')
        .select('*')
        .in('shop_id', effectiveShopIds)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: false })
      setExpenses((data || []) as Expense[])
      setPageCache(cacheKey, data || [])
    } catch {
      const cached = getPageCache<Expense[]>(cacheKey)
      if (cached) setExpenses(cached)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchExpenses() }, [effectiveShopIds.join(','), monthFilter])

  const openAdd = () => {
    setEditing(null)
    setAmount('')
    setDescription('')
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setModalOpen(true)
  }

  const openEdit = (exp: Expense) => {
    setEditing(exp)
    setAmount(String(exp.amount))
    setDescription(exp.description)
    setDate(exp.date)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!shop?.id || !amount || !description.trim()) return
    setSaving(true)
    const payload = {
      shop_id: shop.id,
      amount: Number(amount),
      description: description.trim(),
      date,
    }
    let error: any = null
    if (editing) {
      ;({ error } = await supabase.from('expenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id))
    } else {
      ;({ error } = await supabase.from('expenses').insert(payload))
    }
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: editing ? t('updated') : t('added'), variant: 'success' })
    setModalOpen(false)
    fetchExpenses()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('delete_confirm'))) return
    setDeleting(id)
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    setDeleting(null)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: t('deleted'), variant: 'success' })
    fetchExpenses()
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const monthLabel = new Date(monthFilter + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4 max-w-2xl">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={monthFilter}
            onChange={e => setFilter({ monthFilter: e.target.value })}
            className="rounded-lg border px-3 py-1.5 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-stockshop-blue"
          />
        </div>
        <Button onClick={openAdd} className="bg-stockshop-blue hover:bg-stockshop-blue-light text-white gap-2">
          <Plus className="h-4 w-4" />
          {t('add')}
        </Button>
      </div>

      {/* Total card */}
      <Card className="border-0 shadow-sm bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <Receipt className="h-5 w-5" />
            <span className="text-sm font-medium">{t('total')} — {monthLabel}</span>
          </div>
          <span className="text-xl font-bold text-red-600 dark:text-red-400">{fmt(total)}</span>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('none')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.map(exp => (
            <Card key={exp.id} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{exp.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(exp.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
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
                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                    loading={deleting === exp.id}
                    onClick={() => handleDelete(exp.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
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
          <div className="space-y-1">
            <Label>{t('amount')}</Label>
            <NumericInput
              value={amount}
              onChange={setAmount}
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
          <div className="space-y-1">
            <Label>{t('date')}</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
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
