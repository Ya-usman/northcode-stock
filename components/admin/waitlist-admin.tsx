'use client'

// Admin → Liste d'attente : totaux par métier, filtre, liste et export Excel (lecture seule).
import { useMemo, useState } from 'react'
import { Download, Mail, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { exportTable } from '@/lib/export/table-export'
import { WAITLIST_SECTORS } from '@/lib/site/waitlist'

export interface WaitlistRow {
  id: string; sector: string; sub_trade: string | null; contact: string; contact_kind: 'email' | 'phone'
  locale: string; country: string | null; signups: number; notified_at: string | null; created_at: string; updated_at: string
}

const SECTOR_FR: Record<string, string> = {
  health: 'Santé', services: 'Services et artisans', education: 'Éducation', rental: 'Location', hospitality: 'Hôtels et résidences',
  restaurant: 'Restaurants', beauty: 'Salons de beauté', property: 'Gestion locative', other: 'Autre activité',
}
const SUB_FR: Record<string, string> = { clinic: 'Clinique', pharmacy: 'Pharmacie', laboratory: 'Laboratoire', medical_office: 'Cabinet médical', care_center: 'Centre de soins' }
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

export function WaitlistAdmin({ rows, loadError }: { rows: WaitlistRow[]; loadError: string | null }) {
  const [sector, setSector] = useState<string>('all')
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.sector] = (c[r.sector] || 0) + 1
    return c
  }, [rows])
  const shown = sector === 'all' ? rows : rows.filter(r => r.sector === sector)

  const doExport = () => exportTable({
    kind: 'Liste d\'attente', shopName: sector === 'all' ? 'Tous les métiers' : SECTOR_FR[sector], locale: 'fr',
    labels: { exportedOn: 'Exporté le', sheet: 'Liste d\'attente' },
    columns: [
      { header: 'Métier', width: 20 }, { header: 'Établissement', width: 18 }, { header: 'Contact', width: 30 }, { header: 'Type', width: 10 },
      { header: 'Langue', width: 8 }, { header: 'Pays', width: 8 }, { header: 'Inscriptions', type: 'int', width: 12 },
      { header: 'Inscrit le', type: 'datetime', width: 18 }, { header: 'Prévenu le', type: 'datetime', width: 18 },
    ],
    rows: shown.map(r => [SECTOR_FR[r.sector] ?? r.sector, r.sub_trade ? SUB_FR[r.sub_trade] ?? r.sub_trade : '', r.contact,
      r.contact_kind === 'email' ? 'E-mail' : 'Téléphone', r.locale, r.country ?? '', r.signups, new Date(r.created_at), r.notified_at ? new Date(r.notified_at) : null]),
  }, 'xlsx')

  return (
    <div className="space-y-5 p-4 md:p-6" data-testid="admin-waitlist">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Liste d'attente</h1>
          <p className="text-sm text-muted-foreground">Inscriptions des pages Métiers : chaque personne est prévenue à l'ouverture de son module.</p>
        </div>
        <Button variant="outline" onClick={doExport} disabled={!shown.length} className="gap-2" data-testid="admin-waitlist-export"><Download className="h-4 w-4" />Exporter (Excel)</Button>
      </div>
      {loadError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">Lecture impossible : {loadError}</p>}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par métier">
        <button type="button" onClick={() => setSector('all')} aria-pressed={sector === 'all'} className={`rounded-full border px-3 py-1.5 text-sm ${sector === 'all' ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500 dark:bg-blue-600' : 'bg-card'}`}>
          Tous · {rows.length}
        </button>
        {WAITLIST_SECTORS.filter(s => counts[s]).map(s => (
          <button key={s} type="button" onClick={() => setSector(s)} aria-pressed={sector === s} className={`rounded-full border px-3 py-1.5 text-sm ${sector === s ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500 dark:bg-blue-600' : 'bg-card'}`}>
            {SECTOR_FR[s]} · {counts[s]}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Aucune inscription pour l'instant.</p>
          ) : (
            <ul className="divide-y">
              {shown.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                    {r.contact_kind === 'email' ? <Mail className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{r.contact}</span>
                  </span>
                  <span className="text-muted-foreground">{SECTOR_FR[r.sector] ?? r.sector}{r.sub_trade ? ` · ${SUB_FR[r.sub_trade] ?? r.sub_trade}` : ''}</span>
                  <span className="text-muted-foreground">{r.locale.toUpperCase()}{r.country ? ` · ${r.country}` : ''}</span>
                  {r.signups > 1 && <span className="text-xs text-muted-foreground">{r.signups} inscriptions</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{day(r.created_at)}{r.notified_at ? ` · prévenu le ${day(r.notified_at)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
