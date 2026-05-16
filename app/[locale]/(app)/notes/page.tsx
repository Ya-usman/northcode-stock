'use client'

import { useState, useEffect, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { cn } from '@/lib/utils/cn'
import { Plus, Pin, Pencil, Trash2, Store, Search, PinOff } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'

const supabase = createClient() as any

interface Note {
  id: string
  shop_id: string
  owner_id: string
  title: string | null
  content: string
  color: string
  pinned: boolean
  created_at: string
  updated_at: string
}

const COLORS: { key: string; bg: string; border: string; label: string }[] = [
  { key: 'default', bg: 'bg-card',           border: 'border-border',      label: 'Blanc'   },
  { key: 'yellow',  bg: 'bg-yellow-50 dark:bg-yellow-950/40',  border: 'border-yellow-200 dark:border-yellow-800',  label: 'Jaune'   },
  { key: 'blue',    bg: 'bg-blue-50 dark:bg-blue-950/40',      border: 'border-blue-200 dark:border-blue-800',      label: 'Bleu'    },
  { key: 'green',   bg: 'bg-green-50 dark:bg-green-950/40',    border: 'border-green-200 dark:border-green-800',    label: 'Vert'    },
  { key: 'pink',    bg: 'bg-pink-50 dark:bg-pink-950/40',      border: 'border-pink-200 dark:border-pink-800',      label: 'Rose'    },
  { key: 'purple',  bg: 'bg-purple-50 dark:bg-purple-950/40',  border: 'border-purple-200 dark:border-purple-800',  label: 'Violet'  },
]

function colorFor(key: string) {
  return COLORS.find(c => c.key === key) ?? COLORS[0]
}

export default function NotesPage() {
  const { profile, shop, userShops } = useAuth()
  const { toast } = useToast()

  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [{ search, shopFilter }, setFilter] = usePersistedFilters(
    'notes', shop?.id, { search: '', shopFilter: 'all' }
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [title, setTitle]     = useState('')
  const [content, setContent] = useState('')
  const [color, setColor]     = useState('default')
  const [pinned, setPinned]   = useState(false)
  const [noteShop, setNoteShop] = useState(shop?.id ?? '')
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const effectiveShopIds = userShops.map(s => s.id)

  const fetchNotes = async () => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const cacheKey = `notes_${effectiveShopIds.join(',')}_${shopFilter}`
    try {
      let q = supabase
        .from('notes')
        .select('*')
        .in('shop_id', effectiveShopIds)
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
      if (shopFilter !== 'all') q = q.eq('shop_id', shopFilter)
      const { data } = await q
      setNotes((data || []) as Note[])
      setPageCache(cacheKey, data || [])
    } catch {
      const cached = getPageCache<Note[]>(cacheKey)
      if (cached) setNotes(cached)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchNotes() }, [effectiveShopIds.join(','), shopFilter])

  const openCreate = () => {
    setEditing(null)
    setTitle('')
    setContent('')
    setColor('default')
    setPinned(false)
    setNoteShop(shop?.id ?? effectiveShopIds[0] ?? '')
    setModalOpen(true)
    setTimeout(() => contentRef.current?.focus(), 100)
  }

  const openEdit = (note: Note) => {
    setEditing(note)
    setTitle(note.title ?? '')
    setContent(note.content)
    setColor(note.color)
    setPinned(note.pinned)
    setNoteShop(note.shop_id)
    setModalOpen(true)
  }

  const closeModal = () => { setModalOpen(false); setEditing(null) }

  const save = async () => {
    if (!content.trim() && !title.trim()) return
    setSaving(true)
    const payload = {
      shop_id: noteShop,
      owner_id: profile!.id,
      title: title.trim() || null,
      content: content.trim(),
      color,
      pinned,
    }
    if (editing) {
      const { error } = await supabase.from('notes').update(payload).eq('id', editing.id)
      if (error) { toast({ title: error.message, variant: 'destructive' }); setSaving(false); return }
      toast({ title: 'Note modifiée', variant: 'success' })
    } else {
      const { error } = await supabase.from('notes').insert(payload)
      if (error) { toast({ title: error.message, variant: 'destructive' }); setSaving(false); return }
      toast({ title: 'Note créée', variant: 'success' })
    }
    setSaving(false)
    closeModal()
    fetchNotes()
  }

  const togglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation()
    await supabase.from('notes').update({ pinned: !note.pinned }).eq('id', note.id)
    fetchNotes()
  }

  const deleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleting(id)
    await supabase.from('notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
    setDeleting(null)
    toast({ title: 'Note supprimée', variant: 'success' })
  }

  const filtered = notes.filter(n => {
    if (!search) return true
    const q = search.toLowerCase()
    return (n.title ?? '').toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  })

  const pinned_notes  = filtered.filter(n => n.pinned)
  const regular_notes = filtered.filter(n => !n.pinned)

  const shopName = (shopId: string) => userShops.find(s => s.id === shopId)?.name ?? ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les notes…"
            value={search}
            onChange={e => setFilter({ search: e.target.value })}
            className="pl-9"
          />
        </div>

        {userShops.length > 1 && (
          <select
            value={shopFilter}
            onChange={e => setFilter({ shopFilter: e.target.value })}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">Toutes les boutiques</option>
            {userShops.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Nouvelle note
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Pencil className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">Aucune note</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? 'Aucun résultat pour cette recherche' : 'Créez votre première note avec le bouton ci-dessus'}
          </p>
        </div>
      )}

      {/* Pinned */}
      {pinned_notes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Épinglées
          </p>
          <NoteGrid notes={pinned_notes} onEdit={openEdit} onPin={togglePin} onDelete={deleteNote} deleting={deleting} shopName={shopName} multiShop={userShops.length > 1} />
        </div>
      )}

      {/* Regular */}
      {regular_notes.length > 0 && (
        <div className="space-y-2">
          {pinned_notes.length > 0 && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
              Autres
            </p>
          )}
          <NoteGrid notes={regular_notes} onEdit={openEdit} onPin={togglePin} onDelete={deleteNote} deleting={deleting} shopName={shopName} multiShop={userShops.length > 1} />
        </div>
      )}

      {/* Modal */}
      <PremiumDialog open={modalOpen} onOpenChange={v => { if (!v) closeModal() }} title={editing ? 'Modifier la note' : 'Nouvelle note'}>
        <PremiumDialogBody>
          <div className="space-y-3">
            {/* Title */}
            <Input
              placeholder="Titre (optionnel)"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="font-medium"
            />

            {/* Content */}
            <textarea
              ref={contentRef}
              placeholder="Écrivez votre note ici…"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={6}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            {/* Color picker */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Couleur</p>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setColor(c.key)}
                    title={c.label}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-transform',
                      c.bg.split(' ')[0].replace('bg-', 'bg-').replace('50', '200').replace('/40', ''),
                      color === c.key ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                    )}
                    style={{
                      backgroundColor: c.key === 'default' ? 'hsl(var(--card))' :
                        c.key === 'yellow' ? '#fef08a' : c.key === 'blue' ? '#bfdbfe' :
                        c.key === 'green' ? '#bbf7d0' : c.key === 'pink' ? '#fbcfe8' : '#e9d5ff'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Shop + Pin row */}
            <div className="flex items-center gap-3">
              {userShops.length > 1 && (
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">Boutique</p>
                  <select
                    value={noteShop}
                    onChange={e => setNoteShop(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {userShops.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={cn('flex items-center gap-2', userShops.length <= 1 && 'mt-4')}>
                <button
                  onClick={() => setPinned(p => !p)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    pinned
                      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  <Pin className="h-3.5 w-3.5" />
                  {pinned ? 'Épinglée' : 'Épingler'}
                </button>
              </div>
            </div>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter>
          <Button variant="outline" onClick={closeModal} disabled={saving}>Annuler</Button>
          <Button onClick={save} disabled={saving || (!content.trim() && !title.trim())}>
            {saving ? 'Enregistrement…' : editing ? 'Modifier' : 'Créer'}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}

function NoteGrid({ notes, onEdit, onPin, onDelete, deleting, shopName, multiShop }: {
  notes: Note[]
  onEdit: (n: Note) => void
  onPin: (n: Note, e: React.MouseEvent) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  deleting: string | null
  shopName: (id: string) => string
  multiShop: boolean
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {notes.map(note => {
        const c = colorFor(note.color)
        return (
          <div
            key={note.id}
            onClick={() => onEdit(note)}
            className={cn(
              'group relative rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5',
              c.bg, c.border
            )}
          >
            {/* Actions */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={e => onPin(note, e)}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  note.pinned
                    ? 'text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
                )}
              >
                {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={e => onDelete(note.id, e)}
                disabled={deleting === note.id}
                className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Pin badge */}
            {note.pinned && (
              <Pin className="absolute top-3 right-3 h-3 w-3 text-amber-500 group-hover:opacity-0 transition-opacity" />
            )}

            {/* Title */}
            {note.title && (
              <p className="font-semibold text-sm text-foreground mb-2 pr-6 line-clamp-1">
                {note.title}
              </p>
            )}

            {/* Content */}
            <p className={cn(
              'text-sm text-foreground/80 whitespace-pre-wrap break-words',
              note.title ? 'line-clamp-5' : 'line-clamp-6'
            )}>
              {note.content}
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-black/5 dark:border-white/10">
              {multiShop && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Store className="h-3 w-3" />
                  {shopName(note.shop_id)}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {format(new Date(note.updated_at), 'd MMM', { locale: fr })}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
