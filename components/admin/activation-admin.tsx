'use client'

// Admin → Activation (onboarding lot C2) : où les nouveaux comptes décrochent.
// Lecture seule. Les comptes « À accompagner » viennent en premier : c'est ce qu'on fait
// de cette page (un appel ou un message peut éviter un départ).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { CheckCircle2, Clock, Mail, Package, PenLine, Phone, RefreshCw, ShoppingCart, UserPlus } from 'lucide-react'
import { SupportContactDrawer } from '@/components/admin/support-contact-drawer'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { KpiTile } from '@/components/admin/ui/kpi-tile'
import { AdminTable } from '@/components/admin/ui/admin-table'
import { ANNOUNCEMENT_TOURS } from '@/lib/announcements/catalog'
import { FUNNEL_STEPS, type ActivationAccount, type Cohort, type FunnelStep, type NudgeStat, type TourStat } from '@/lib/admin/activation'
import { cn } from '@/lib/utils/cn'

interface Data {
  generatedAt: string
  summary: { total: number; reached: Record<FunnelStep, number>; medianHoursToProduct: number | null; medianHoursToSale: number | null }
  cohorts: Cohort[]
  tours: TourStat[]
  nudges: NudgeStat[]
  unsubscribed: number
  toHelp: { account: ActivationAccount; ageDays: number; missing: 'product' | 'sale' }[]
}

const STEP_LABEL: Record<FunnelStep, string> = { product: 'Produit', sale: 'Vente', category: 'Catégorie', member: 'Membre', receipt: 'Reçu' }
const NUDGE_LABEL = { d1: 'J+1 · premier produit', d3: 'J+3 · produit ou vente', d7: 'J+7 · offre d’aide' } as const
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)
const duration = (h: number | null) => (h === null ? '—' : h < 1 ? '< 1 h' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`)
const weekLabel = (t: number) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' })

/** « Contacté le 6 oct. par Ghislain (e-mail) » */
function LastContact({ c }: { c: ActivationAccount['lastContact'] }) {
  if (!c) return null
  const when = new Date(c.at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' })
  return <p className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400" data-testid="last-contact"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />Contacté le {when}{c.by ? ` par ${c.by.split(' ')[0]}` : ''} ({c.channel === 'email' ? 'e-mail' : 'WhatsApp'})</p>
}

export function ActivationAdmin() {
  const locale = useLocale()
  const t = useTranslations('onboarding')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [contactOwner, setContactOwner] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/activation')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur de chargement')
      setData(json); setError(null)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const s = data?.summary
  const tourName = (id: string) => ANNOUNCEMENT_TOURS.find(x => x.tour === id)?.label.replace(/ \(.*\)$/, '') ?? id
  const stepName = (tour: string, step: string) => { try { return t(`tours.${tour}.${step}.title` as any) } catch { return step } }

  return (
    <div className="space-y-6" data-testid="activation-admin">
      <AdminPageHeader
        title="Activation"
        description="Où les nouveaux comptes décrochent — inscrits ces 8 dernières semaines, comptes internes et de test exclus."
        actions={<Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />Actualiser</Button>}
      />

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400" role="alert">{error}</p>}

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="activation-kpis">
        {!s ? [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : <>
          <KpiTile label="Nouveaux comptes (8 sem.)" value={s.total} icon={UserPlus} />
          <KpiTile label={`Avec un produit · ${pct(s.reached.product, s.total)} %`} value={s.reached.product} icon={Package} tone={pct(s.reached.product, s.total) < 50 ? 'warning' : 'success'} />
          <KpiTile label={`Avec une vente · ${pct(s.reached.sale, s.total)} %`} value={s.reached.sale} icon={ShoppingCart} tone={pct(s.reached.sale, s.total) < 50 ? 'warning' : 'success'} />
          <KpiTile label="Délai médian : 1er produit · 1re vente" value={`${duration(s.medianHoursToProduct)} · ${duration(s.medianHoursToSale)}`} icon={Clock} />
        </>}
      </div>

      {/* À accompagner */}
      <section className="min-w-0 space-y-2" aria-labelledby="act-help">
        <div>
          <h2 id="act-help" className="font-semibold">À accompagner</h2>
          <p className="text-sm text-muted-foreground">Inscrits depuis moins de 14 jours, sans produit ou sans vente. Un appel ou un message peut éviter un départ.</p>
        </div>
        {/* Téléphone : une carte par compte (un tableau à 6 colonnes y serait illisible) */}
        <ul className="space-y-2 md:hidden" data-testid="activation-help-cards">
          {loading && !data ? <Skeleton className="h-28 rounded-xl" /> : !data?.toHelp.length ? (
            <li className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Aucun compte à accompagner pour l’instant.</li>
          ) : data.toHelp.map(r => (
            <li key={r.account.ownerId} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/${locale}/admin/shops/${r.account.shopId}`} className="font-medium text-stockshop-blue hover:underline dark:text-blue-400">{r.account.shopName}</Link>
                  <p className="text-sm text-muted-foreground">{r.account.ownerName || '—'} · {r.ageDays === 0 ? 'inscrit aujourd’hui' : `inscrit il y a ${r.ageDays} j`}</p>
                  <LastContact c={r.account.lastContact} />
                </div>
                <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', r.missing === 'product' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400')}>{r.missing === 'product' ? 'Premier produit' : 'Première vente'}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="stockshop" size="sm" className="h-10 gap-1.5" onClick={() => setContactOwner(r.account.ownerId)} data-testid="help-write"><PenLine className="h-4 w-4" />Écrire</Button>
                {r.account.phone && <Button asChild variant="outline" size="sm" className="h-10 gap-1.5"><a href={`tel:${r.account.phone.replace(/\s+/g, '')}`}><Phone className="h-4 w-4" />Appeler</a></Button>}
                {r.account.email && <Button asChild variant="outline" size="sm" className="h-10 min-w-0 max-w-full gap-1.5"><a href={`mailto:${r.account.email}`}><Mail className="h-4 w-4 flex-shrink-0" /><span className="truncate">{r.account.email}</span></a></Button>}
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
        <AdminTable
          loading={loading && !data}
          rows={data?.toHelp ?? []}
          rowKey={r => r.account.ownerId}
          emptyMessage="Aucun compte à accompagner pour l’instant."
          columns={[
            { key: 'shop', header: 'Boutique' }, { key: 'owner', header: 'Propriétaire' }, { key: 'contact', header: 'Contact' },
            { key: 'age', header: 'Inscrit', align: 'right' }, { key: 'missing', header: 'Bloqué à' }, { key: 'counts', header: 'Produits · ventes', align: 'right' }, { key: 'act', header: '', align: 'right' },
          ]}
          renderRow={r => (<>
            <td className="px-3 py-2.5"><Link href={`/${locale}/admin/shops/${r.account.shopId}`} className="font-medium text-stockshop-blue hover:underline dark:text-blue-400">{r.account.shopName}</Link>{r.account.shopCount > 1 && <span className="ml-1 text-xs text-muted-foreground">+{r.account.shopCount - 1}</span>}</td>
            <td className="px-3 py-2.5 whitespace-nowrap">{r.account.ownerName || '—'}</td>
            <td className="px-3 py-2.5">
              <div className="flex flex-col gap-0.5 text-xs">
                {r.account.phone && <a href={`tel:${r.account.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="h-3 w-3" />{r.account.phone}</a>}
                {r.account.email && <a href={`mailto:${r.account.email}`} className="inline-flex items-center gap-1 break-all hover:underline"><Mail className="h-3 w-3 flex-shrink-0" />{r.account.email}</a>}
              </div>
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{r.ageDays === 0 ? 'aujourd’hui' : `il y a ${r.ageDays} j`}</td>
            <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', r.missing === 'product' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400')}>{r.missing === 'product' ? 'Premier produit' : 'Première vente'}</span></td>
            <td className="px-3 py-2.5 text-right tabular-nums">{r.account.products} · {r.account.sales}</td>
            <td className="px-3 py-2.5 text-right">
              <div className="flex flex-col items-end gap-1">
                <Button variant="stockshop" size="sm" className="h-8 gap-1.5" onClick={() => setContactOwner(r.account.ownerId)} data-testid="help-write"><PenLine className="h-3.5 w-3.5" />Écrire</Button>
                <LastContact c={r.account.lastContact} />
              </div>
            </td>
          </>)}
        />
        </div>
      </section>

      {/* Entonnoir par semaine */}
      <section className="min-w-0 space-y-2" aria-labelledby="act-funnel">
        <div>
          <h2 id="act-funnel" className="font-semibold">Entonnoir par semaine d’inscription</h2>
          <p className="text-sm text-muted-foreground">Part des comptes de chaque semaine qui ont franchi l’étape (à ce jour).</p>
        </div>
        <AdminTable
          loading={loading && !data}
          rows={data?.cohorts ?? []}
          rowKey={c => String(c.week)}
          columns={[{ key: 'week', header: 'Semaine du' }, { key: 'n', header: 'Comptes', align: 'right' }, ...FUNNEL_STEPS.map(st => ({ key: st, header: STEP_LABEL[st], align: 'right' as const }))]}
          renderRow={c => (<>
            <td className="px-3 py-2.5 whitespace-nowrap">{weekLabel(c.week)}</td>
            <td className="px-3 py-2.5 text-right font-medium tabular-nums">{c.accounts || '—'}</td>
            {FUNNEL_STEPS.map(st => {
              const p = pct(c.reached[st], c.accounts)
              return (
                <td key={st} className="px-3 py-2.5 text-right tabular-nums">
                  {c.accounts ? (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span>{p} % <span className="text-xs text-muted-foreground">({c.reached[st]})</span></span>
                      <span className="block h-1 w-14 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-stockshop-blue dark:bg-blue-400" style={{ width: `${p}%` }} /></span>
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              )
            })}
          </>)}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        {/* Tours guidés */}
        <section className="min-w-0 space-y-2" aria-labelledby="act-tours">
          <div>
            <h2 id="act-tours" className="font-semibold">Tours guidés</h2>
            <p className="text-sm text-muted-foreground">Une personne compte une fois par tour (son dernier état). Abandons : l’étape où elle s’est arrêtée, suivie depuis le 6 oct. 2026.</p>
          </div>
          <AdminTable
            loading={loading && !data}
            rows={data?.tours ?? []}
            rowKey={r => r.tour}
            columns={[{ key: 'tour', header: 'Tour' }, { key: 'st', header: 'Lancés', align: 'right' }, { key: 'ok', header: 'Terminés', align: 'right' }, { key: 'ko', header: 'Abandonnés', align: 'right' }, { key: 'steps', header: 'Arrêts par étape' }]}
            renderRow={r => (<>
              <td className="px-3 py-2.5 whitespace-nowrap font-medium">{tourName(r.tour)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.started}{r.inProgress > 0 && <span className="block text-[11px] text-muted-foreground">{r.inProgress} en cours</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.completed}{r.started > 0 && <span className="block text-[11px] text-muted-foreground">{pct(r.completed, r.started)} %</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.skipped}</td>
              <td className="px-3 py-2.5">
                {r.skippedSteps.length ? (
                  <div className="flex flex-wrap gap-1">{r.skippedSteps.map(x => <span key={x.step} className="rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">{stepName(r.tour, x.step)} · {x.count}</span>)}</div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </td>
            </>)}
          />
        </section>

        {/* Relances e-mail */}
        <section className="min-w-0 space-y-2" aria-labelledby="act-nudges">
          <div>
            <h2 id="act-nudges" className="font-semibold">Relances e-mail</h2>
            <p className="text-sm text-muted-foreground">« Suivies d’effet » : produit ajouté (ou vente faite) dans les 3 jours après l’envoi.</p>
          </div>
          <AdminTable
            loading={loading && !data}
            rows={data?.nudges ?? []}
            rowKey={r => r.nudge}
            columns={[{ key: 'n', header: 'Relance' }, { key: 'sent', header: 'Envoyées', align: 'right' }, { key: 'acted', header: 'Suivies d’effet', align: 'right' }]}
            renderRow={r => (<>
              <td className="px-3 py-2.5 whitespace-nowrap">{NUDGE_LABEL[r.nudge]}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.sent}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.acted}{r.sent > 0 && <span className="ml-1 text-xs text-muted-foreground">({pct(r.acted, r.sent)} %)</span>}</td>
            </>)}
          />
          {data && <p className="text-xs text-muted-foreground" data-testid="activation-unsub">Désinscriptions des conseils : {data.unsubscribed}</p>}
        </section>
      </div>

      <SupportContactDrawer ownerId={contactOwner} onOpenChange={o => { if (!o) setContactOwner(null) }} onSent={load} />

      {data && <p className="text-xs text-muted-foreground">Calculé le {new Date(data.generatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' })} (heure de Paris).</p>}
    </div>
  )
}
