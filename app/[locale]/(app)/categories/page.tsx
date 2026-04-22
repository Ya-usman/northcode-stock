'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Trash2, Tag, Search, RotateCcw, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils/cn'
import type { Category, Product } from '@/lib/types/database'

export default function CategoriesPage() {
  const t = useTranslations()
  const { shop, profile } = useAuthContext()
  const supabase = createClient()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = async () => {
    if (!shop?.id) return
    try {
      const [catRes, prodData] = await Promise.all([
        fetch(`/api/categories?shop_id=${shop.id}`),
        supabase.from('products').select('id, name, selling_price, quantity, unit, category_id').eq('shop_id', shop.id).eq('is_active', true).order('name'),
      ])
      const catJson = await catRes.json()
      setCategories((catJson.data || []) as Category[])
      setProducts((prodData.data || []) as unknown as Product[])
    } catch { /* keep */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [shop?.id])

  const openDialog = () => {
    setNewName('')
    setDialogOpen(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

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
    setDialogOpen(false)
    setNewName('')
    fetchData()
    toast({ title: t('categories.added'), variant: 'success' })
  }

  const deleteCategory = async (cat: Category) => {
    if (!confirm(t('categories.delete_confirm', { name: cat.name }))) return
    const res = await fetch(`/api/categories?id=${cat.id}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (!res.ok) { toast({ title: t('categories.delete_error'), variant: 'destructive' }); return }
    fetchData()
    toast({ title: t('categories.deleted') })
  }

  const restoreDefaults = async () => {
    if (!shop?.id) return
    setSeeding(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      await fetchData()
      toast({
        title: t('categories.restored'),
        description: `${json.categoriesCreated} catégorie(s) ajoutée(s) · ${json.productsAssigned} produit(s) mis à jour`,
        variant: 'success',
      })
    } catch {
      toast({ title: t('toast.error'), variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  const canEdit = profile?.role === 'owner' || profile?.role === 'stock_manager'
  const filtered = categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  // Products without any category
  const uncategorized = products.filter(p => !p.category_id)

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('categories.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('categories.subtitle')}</p>
      </div>

      {/* Search + Add row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('categories.search_placeholder')}
            className="pl-9 h-9"
          />
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={restoreDefaults}
              loading={seeding}
              className="gap-1.5 h-9 px-3 text-sm text-muted-foreground"
              title={t('categories.restore_hint')}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t('categories.restore')}</span>
            </Button>
            <Button onClick={openDialog} className="bg-northcode-blue gap-1.5 h-9 px-3 text-sm">
              <Plus className="h-4 w-4" />
              {t('categories.add')}
            </Button>
          </div>
        )}
      </div>

      {/* Category list with products */}
      <div className="space-y-2">
        {loading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Tag className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">{search ? t('categories.no_results') : t('categories.none')}</p>
            {canEdit && !search && <p className="text-xs mt-1">{t('categories.add_hint')}</p>}
          </div>
        ) : (
          filtered.map(cat => {
            const catProducts = products.filter(p => p.category_id === cat.id)
            const isExpanded = expandedId === cat.id

            return (
              <div key={cat.id} className="rounded-lg border bg-card shadow-sm overflow-hidden">
                {/* Category header row */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
                      <Tag className="h-4 w-4 text-northcode-blue dark:text-blue-400" />
                    </div>
                    <span className="font-medium text-sm truncate">{cat.name}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {catProducts.length}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {canEdit && (
                      <span
                        role="button"
                        className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        onClick={e => { e.stopPropagation(); deleteCategory(cat) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    }
                  </div>
                </button>

                {/* Product list */}
                {isExpanded && (
                  <div className="border-t bg-muted/10">
                    {catProducts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">{t('categories.no_products_in_cat')}</p>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {catProducts.map(p => (
                          <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm truncate">{p.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-2">
                              <span className="text-xs text-muted-foreground">{p.quantity} {(p as any).unit}</span>
                              <span className="text-sm font-semibold text-northcode-blue dark:text-blue-400">
                                {Number(p.selling_price).toLocaleString('fr-FR')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Uncategorized products */}
        {!search && uncategorized.length > 0 && (
          <div className="rounded-lg border border-dashed bg-card shadow-sm overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              onClick={() => setExpandedId(expandedId === '__none__' ? null : '__none__')}
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="font-medium text-sm text-muted-foreground">{t('categories.uncategorized')}</span>
                <Badge variant="outline" className="text-xs">{uncategorized.length}</Badge>
              </div>
              {expandedId === '__none__'
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
              }
            </button>
            {expandedId === '__none__' && (
              <div className="border-t bg-muted/10 divide-y divide-border/50">
                {uncategorized.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{p.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-northcode-blue dark:text-blue-400 shrink-0 ml-2">
                      {Number(p.selling_price).toLocaleString('fr-FR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('categories.count', { count: filtered.length })} · {products.length} {t('categories.products_total')}
        </p>
      )}

      {/* Add category dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) setNewName('') }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-northcode-blue dark:text-blue-400" />
              {t('categories.add_dialog_title')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="cat-name">{t('categories.add_dialog_label')}</Label>
            <Input
              id="cat-name"
              ref={inputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('categories.add_placeholder')}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              size="sm"
              loading={saving}
              disabled={!newName.trim()}
              onClick={addCategory}
              className="bg-northcode-blue hover:bg-northcode-blue-light dark:bg-blue-500"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('categories.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
