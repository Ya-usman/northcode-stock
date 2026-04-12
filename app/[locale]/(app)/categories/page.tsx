'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Tag } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { Category } from '@/lib/types/database'

export default function CategoriesPage() {
  const { shop, profile } = useAuthContext()
  const supabase = createClient()
  const { toast } = useToast()

  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchCategories = async () => {
    if (!shop?.id) return
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('shop_id', shop.id)
      .order('name')
    setCategories((data || []) as Category[])
    setLoading(false)
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
    if (!res.ok) { toast({ title: json.error || 'Erreur', variant: 'destructive' }); return }
    setNewName('')
    fetchCategories()
    toast({ title: 'Catégorie ajoutée', variant: 'success' })
  }

  const deleteCategory = async (cat: Category) => {
    if (!confirm(`Supprimer "${cat.name}" ? Les produits liés perdront leur catégorie.`)) return
    const res = await fetch(`/api/categories?id=${cat.id}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (!res.ok) { toast({ title: 'Erreur lors de la suppression', variant: 'destructive' }); return }
    fetchCategories()
    toast({ title: 'Catégorie supprimée' })
  }

  const canEdit = profile?.role === 'owner' || profile?.role === 'stock_manager'

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-bold">Catégories de produits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Organisez vos produits par catégorie pour les retrouver facilement.
        </p>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nom de la catégorie…"
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            className="flex-1"
          />
          <Button onClick={addCategory} loading={saving} disabled={!newName.trim()} className="bg-northcode-blue shrink-0 gap-1">
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Tag className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Aucune catégorie pour l'instant</p>
            {canEdit && <p className="text-xs mt-1">Ajoutez-en une ci-dessus</p>}
          </div>
        ) : (
          categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between rounded-lg border bg-white px-4 py-3 shadow-sm">
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
        <p className="text-xs text-muted-foreground">
          {categories.length} catégorie{categories.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
