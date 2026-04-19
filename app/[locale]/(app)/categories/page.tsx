'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Trash2, Tag } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { Category } from '@/lib/types/database'

export default function CategoriesPage() {
  const t = useTranslations()
  const { shop, profile } = useAuthContext()
  const supabase = createClient()
  const { toast } = useToast()

  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchCategories = async () => {
    if (!shop?.id) return
    try {
      const res = await fetch(`/api/categories?shop_id=${shop.id}`)
      const json = await res.json()
      setCategories((json.data || []) as Category[])
    } catch { /* keep */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCategories() }, [shop?.id])

  const addCategory = async () => {
    if (!shop?.id || !newName.trim()) return
    setSaving(true)
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shop.id, name: newName.trim() }),
    })
    setSaving(false)
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    setNewName('')
    fetchCategories()
    toast({ title: t('categories.added'), variant: 'success' })
  }

  const deleteCategory = async (cat: Category) => {
    if (!confirm(t('categories.delete_confirm', { name: cat.name }))) return
    const res = await fetch(`/api/categories?id=${cat.id}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (!res.ok) { toast({ title: t('categories.delete_error'), variant: 'destructive' }); return }
    fetchCategories()
    toast({ title: t('categories.deleted') })
  }

  const canEdit = profile?.role === 'owner' || profile?.role === 'stock_manager'

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('categories.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('categories.subtitle')}</p>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('categories.add_placeholder')}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            className="flex-1"
          />
          <Button onClick={addCategory} loading={saving} disabled={!newName.trim()} className="bg-northcode-blue shrink-0 gap-1">
            <Plus className="h-4 w-4" />
            {t('categories.add')}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Tag className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">{t('categories.none')}</p>
            {canEdit && <p className="text-xs mt-1">{t('categories.add_hint')}</p>}
          </div>
        ) : (
          categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-northcode-blue-muted flex items-center justify-center">
                  <Tag className="h-4 w-4 text-northcode-blue" />
                </div>
                <span className="font-medium text-sm">{cat.name}</span>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteCategory(cat)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {categories.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('categories.count', { count: categories.length })}</p>
      )}
    </div>
  )
}
