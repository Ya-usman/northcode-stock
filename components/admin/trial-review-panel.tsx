'use client'

// « Essais à vérifier » (protection de l'essai, migration 213) — Admin → Activation. Inscriptions des 60 derniers
// jours dont l'essai a été refusé (numéro déjà utilisé) ou signalé (même appareil, même nom et même ville qu'un essai
// récent). Un signalement ne bloque rien. Essai accordé à la main : super_admin, motif obligatoire, journalisé.
// Console interne en français (comme le reste de l'admin).

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'

interface Row {
  id: string; entity_id: string | null; entity_name: string | null; owner_name: string | null; source: 'register' | 'oauth'
  granted: boolean; flags: string[]; created_at: string; trial_status: string | null; deleted: boolean
  admin_grant: { reason: string; at: string } | null
}

const FLAG: Record<string, string> = { phone_reused: 'Numéro déjà utilisé', same_device: 'Même appareil', same_name_city: 'Même nom et même ville' }
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' })

export function TrialReviewPanel() {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [edit, setEdit] = useState<{ entity_id: string; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await withTimeout(fetch('/api/admin/trial-review')).catch(() => null)
    if (!res || !res.ok) { setRows([]); return }
    setRows((await res.json()).rows || [])
  }, [])
  useEffect(() => { load() }, [load])

  const grant = async () => {
    if (!edit) return
    setBusy(true)
    try {
      const res = await withTimeout(fetch('/api/admin/trial-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: json.error || 'Action refusée', variant: 'destructive' }); return }
      toast({ title: 'Essai de 30 jours accordé', variant: 'success' })
      setEdit(null); await load()
    } finally { setBusy(false) }
  }

  return (
    <section className="min-w-0 space-y-2 rounded-xl border bg-card p-4 shadow-sm" data-testid="trial-review-panel">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Essais à vérifier</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Un numéro donne droit à un essai sur 12 mois. Un même appareil, ou un même nom dans la même ville, est seulement
        signalé : rien n’est bloqué. Accorder l’essai à la main si le cas est légitime (numéro partagé, erreur de saisie).
      </p>
      {rows === null ? <p className="text-xs text-muted-foreground">Chargement…</p> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="trial-review-empty">Aucun essai à vérifier.</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map(r => {
            const open = edit?.entity_id === r.entity_id
            return (
              <div key={r.id} className="py-3 text-sm" data-testid="trial-review-row">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{r.entity_name || 'Compte supprimé'}{r.owner_name ? <span className="text-xs text-muted-foreground"> · {r.owner_name}</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{day(r.created_at)} · {r.source === 'oauth' ? 'Google / Apple' : 'formulaire'}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {r.flags.map(f => <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{FLAG[f] ?? f}</span>)}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs" data-testid="trial-review-status">
                      {r.trial_status === 'refused' ? 'Essai refusé' : r.admin_grant ? 'Essai accordé à la main' : 'Essai accordé'}
                    </span>
                  </div>
                  {r.trial_status === 'refused' && r.entity_id && !open && (
                    <Button size="sm" variant="outline" onClick={() => setEdit({ entity_id: r.entity_id!, reason: '' })} data-testid="trial-grant-open">Accorder l’essai</Button>
                  )}
                </div>
                {r.admin_grant && <p className="mt-1 text-xs text-muted-foreground">Accordé le {day(r.admin_grant.at)} : « {r.admin_grant.reason} »</p>}
                {open && edit && (
                  <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-3">
                    <Input value={edit.reason} maxLength={300} placeholder="Motif (ex. numéro partagé en famille)" onChange={e => setEdit({ ...edit, reason: e.target.value })} data-testid="trial-grant-reason" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || edit.reason.trim().length < 3} onClick={grant} data-testid="trial-grant-confirm">Accorder 30 jours</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>Annuler</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
