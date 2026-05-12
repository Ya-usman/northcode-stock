'use client'

import { useState } from 'react'
import { RotateCcw, Trash2, Store, ChevronDown, ChevronUp, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface DeletedShop {
  id: string
  name: string
  city?: string
  country?: string
  owner_id: string | null
  deleted_at: string
  created_at: string
  ownerEmail?: string | null
  ownerName?: string | null
}

interface Props {
  shops: DeletedShop[]
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export function DeletedShopsPanel({ shops: initialShops }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [shops, setShops] = useState(initialShops)
  const [restoring, setRestoring] = useState<string | null>(null)

  if (shops.length === 0) return null

  const handleRestore = async (shopId: string, shopName: string) => {
    setRestoring(shopId)
    try {
      const res = await fetch(`/api/shops/${shopId}`, { method: 'PATCH' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur')
      toast({ title: `✅ Boutique « ${shopName} » restaurée`, variant: 'success' })
      setShops(prev => prev.filter(s => s.id !== shopId))
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-red-500/20 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <span className="font-semibold text-foreground text-sm">Boutiques supprimées</span>
          <span className="bg-red-500/15 text-red-400 text-xs font-medium px-2 py-0.5 rounded-full">
            {shops.length}
          </span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />
        }
      </button>

      {open && (
        <div className="border-t border-border/50 divide-y divide-border/40">
          {shops.map(shop => {
            const flag = shop.country === 'CM' ? '🇨🇲' : '🇳🇬'
            const days = daysSince(shop.deleted_at)
            return (
              <div key={shop.id} className="flex items-center gap-3 px-5 py-3 bg-red-500/5">
                <div className="h-8 w-8 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <Store className="h-4 w-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate line-through decoration-red-400/60">
                    {shop.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {shop.city && (
                      <span className="text-xs text-muted-foreground">{flag} {shop.city}</span>
                    )}
                    {shop.ownerName && (
                      <span className="text-xs text-muted-foreground">· {shop.ownerName}</span>
                    )}
                    {shop.ownerEmail && (
                      <span className="text-xs text-muted-foreground truncate">· {shop.ownerEmail}</span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <Clock className="h-3 w-3" />
                      Supprimée il y a {days}j
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-green-700/50 text-green-400 hover:bg-green-900/20 flex-shrink-0"
                  disabled={restoring === shop.id}
                  onClick={() => handleRestore(shop.id, shop.name)}
                >
                  <RotateCcw className={`h-3 w-3 ${restoring === shop.id ? 'animate-spin' : ''}`} />
                  Restaurer
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
