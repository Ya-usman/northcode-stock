export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

// Catalogue des tâches cron connues (voir vercel.json) — le nom doit
// correspondre exactement au job_name journalisé par lib/api/cron-log.ts
// dans chaque route app/api/cron/*/route.ts.
const CRON_JOBS = [
  { name: 'morning-check',     label: 'Bilan du matin',              schedule: '07h00, quotidien' },
  { name: 'low-stock-alert',   label: 'Alerte stock faible',         schedule: '07h00, quotidien' },
  { name: 'expiry-alert',      label: 'Alerte péremption',           schedule: '07h00, quotidien' },
  { name: 'renewal-check',     label: 'Renouvellement abonnements',  schedule: '09h00, quotidien' },
  { name: 'evening-summary',   label: 'Résumé du soir',              schedule: '17h00, quotidien' },
  { name: 'orphan-shop-check', label: 'Boutiques orphelines',        schedule: '04h00, quotidien' },
  { name: 'referral-maturity', label: 'Maturation récompenses parrainage', schedule: '05h00, quotidien' },
]

// Marge de sécurité avant de considérer une tâche quotidienne "en retard"
// (fuseaux horaires, léger retard Vercel...).
const STALE_AFTER_HOURS = 36

type RunStatus = 'success' | 'error'
interface CronRun {
  id: string
  job_name: string
  status: RunStatus
  summary: Record<string, any> | null
  error: string | null
  created_at: string
}

function summarize(summary: Record<string, any> | null): string | null {
  if (!summary) return null
  const parts: string[] = []
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue // results/services détaillés — trop long pour la vue liste
    parts.push(`${key}: ${value}`)
  }
  return parts.length ? parts.join(' · ') : null
}

export default async function AdminSystemPage() {
  const admin = createAdminClient() as any

  // Fenêtre assez large pour couvrir plusieurs jours par tâche (6 tâches ×
  // ~5 exécutions récentes) — réduit ensuite en mémoire, plus simple que
  // du SQL "distinct on" via le client Supabase.
  const { data: runs } = await admin
    .from('cron_runs')
    .select('id, job_name, status, summary, error, created_at')
    .order('created_at', { ascending: false })
    .limit(300)

  const byJob: Record<string, CronRun[]> = {}
  for (const r of (runs || []) as CronRun[]) {
    if (!byJob[r.job_name]) byJob[r.job_name] = []
    if (byJob[r.job_name].length < 5) byJob[r.job_name].push(r)
  }

  const now = Date.now()

  return (
    <div className="space-y-5 max-w-4xl">
      <AdminPageHeader
        title="Système"
        description="État des tâches automatiques (cron) — renouvellements, alertes stock/péremption, résumés"
      />

      <div className="space-y-3">
        {CRON_JOBS.map(job => {
          const history = byJob[job.name] || []
          const last = history[0]
          const hoursSinceLast = last ? (now - new Date(last.created_at).getTime()) / 3_600_000 : null
          const isStale = hoursSinceLast !== null && hoursSinceLast > STALE_AFTER_HOURS

          const state: 'ok' | 'error' | 'stale' | 'unknown' =
            !last ? 'unknown' : last.status === 'error' ? 'error' : isStale ? 'stale' : 'ok'

          const STATE_CONFIG = {
            ok:      { icon: CheckCircle2,  color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-border',        label: 'OK' },
            error:   { icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-500/30',    label: 'Échec' },
            stale:   { icon: AlertTriangle, color: 'text-amber-400',  bg: 'bg-amber-400/10',  border: 'border-amber-500/30',  label: 'En retard' },
            unknown: { icon: HelpCircle,    color: 'text-muted-foreground', bg: 'bg-muted',   border: 'border-border',        label: 'Jamais exécutée' },
          }[state]
          const Icon = STATE_CONFIG.icon
          const summaryText = last ? summarize(last.summary) : null

          return (
            <div key={job.name} className={`bg-card rounded-xl border ${STATE_CONFIG.border} shadow-sm p-4`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${STATE_CONFIG.bg}`}>
                    <Icon className={`h-4.5 w-4.5 ${STATE_CONFIG.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{job.label}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATE_CONFIG.bg} ${STATE_CONFIG.color}`}>
                        {STATE_CONFIG.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {job.schedule}
                    </p>
                    {last ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        Dernière exécution {formatDistanceToNow(new Date(last.created_at), { addSuffix: true, locale: fr })}
                        {summaryText && <span className="text-muted-foreground/70"> · {summaryText}</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">Aucune exécution enregistrée pour l'instant.</p>
                    )}
                    {last?.status === 'error' && last.error && (
                      <p className="text-xs text-red-400 mt-1 font-mono">{last.error}</p>
                    )}
                  </div>
                </div>

                {/* Historique récent — points colorés, plus récent à droite */}
                {history.length > 0 && (
                  <div className="flex items-center gap-1 flex-shrink-0" title="Historique récent (plus récent à droite)">
                    {[...history].reverse().map(r => (
                      <span
                        key={r.id}
                        className={`h-2 w-2 rounded-full ${r.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
