'use client'

// « Ajouter une dette existante » (reprise de dette, migration 168) — page Crédits.
// Le commerçant reprend son cahier : ce qu'un client lui doit déjà, ou ce qu'il
// doit déjà à un fournisseur. La reprise rejoint les crédits (remboursements,
// échéance, abandon) mais n'entre JAMAIS dans le chiffre d'affaires ni les achats.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpenCheck, Check, UserPlus } from 'lucide-react'
import { FormDrawer } from '@/components/ui/form-drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { normalize } from '@/lib/utils/normalize'
import { cn } from '@/lib/utils/cn'

const supabase = createClient() as any
type Party = { id: string; name: string; phone: string | null }

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function OpeningBalanceDrawer({ open, onOpenChange, kind, shopId: defaultShopId, shops = [], currencySymbol, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'customer' | 'supplier'
  shopId: string
  // vue « Toutes les boutiques » : la reprise doit être rattachée à une boutique choisie explicitement
  shops?: { id: string; name: string }[]
  currencySymbol: string
  onCreated: () => void
}) {
  const t = useTranslations('payments')
  const { toast } = useToast()
  const [parties, setParties] = useState<Party[]>([])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Party | null>(null)
  const [newPhone, setNewPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [debtDate, setDebtDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef<string>('')
  const [shopId, setShopId] = useState(defaultShopId)
  // Formulaire remis à zéro à chaque ouverture
  useEffect(() => {
    if (!open) return
    setShopId(defaultShopId)
    setNewPhone(''); setAmount(''); setDebtDate(todayIso()); setDueDate(''); setNote(''); setError(null)
    requestId.current = crypto.randomUUID()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clients / fournisseurs de la boutique choisie (changer de boutique annule le choix)
  useEffect(() => {
    if (!open) return
    setPicked(null); setQuery(''); setParties([])
    let alive = true
    supabase.from(kind === 'customer' ? 'customers' : 'suppliers').select('id, name, phone').eq('shop_id', shopId).is('deleted_at', null).order('name')
      .then(({ data }: any) => { if (alive) setParties(data || []) })
    return () => { alive = false }
  }, [open, kind, shopId])

  const matches = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return parties.slice(0, 6)
    return parties.filter(p => normalize(p.name).includes(q) || (p.phone || '').replace(/\D/g, '').includes(query.replace(/\D/g, '') || '§')).slice(0, 6)
  }, [query, parties])
  const exact = parties.some(p => normalize(p.name) === normalize(query.trim()))
  const newName = !picked && query.trim() && !exact ? query.trim() : ''
  const value = Number(String(amount).replace(/[\s ]/g, '').replace(',', '.'))
  const valid = (!!picked || !!newName) && Number.isFinite(value) && value > 0 && !!debtDate && debtDate <= todayIso() && (!dueDate || dueDate >= debtDate)
  const who = picked?.name || newName

  const submit = async () => {
    if (!valid) { setError(t('opening_fill_required')); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/opening-balances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId, kind, party_id: picked?.id, new_party: picked ? undefined : { name: newName, phone: newPhone || null },
          amount: value, debt_date: debtDate, due_date: kind === 'customer' ? dueDate || null : null, note, client_request_id: requestId.current,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.field === 'phone' ? t('opening_phone_invalid') : json.error || t('opening_error'))
      toast({ title: t('opening_created', { number: json.number, name: json.party_name }), variant: 'success' })
      onCreated(); onOpenChange(false)
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <FormDrawer
      open={open}
      onOpenChange={onOpenChange}
      category={t('opening_category')}
      title={kind === 'customer' ? t('opening_title_customer') : t('opening_title_supplier')}
      icon={<BookOpenCheck className="h-4 w-4" />}
      width="md"
      dirty={!!(query || amount || note)}
      onSubmit={submit}
      submitting={saving}
      submitLabel={t('opening_submit')}
      submitDisabled={!valid}
      error={error}
      testId="opening-drawer"
    >
      <div className="space-y-4">
        {shops.length > 1 && (
          <div className="space-y-1.5">
            <Label>{t('opening_shop')}</Label>
            <div className="flex flex-wrap gap-2" data-testid="opening-shops">
              {shops.map(s => (
                <button key={s.id} type="button" onClick={() => setShopId(s.id)}
                  className={cn('min-h-[40px] rounded-lg border px-3 text-sm font-medium transition-colors', s.id === shopId ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500 dark:bg-blue-500' : 'bg-card hover:bg-muted/50')}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="rounded-lg bg-stockshop-blue-muted px-3 py-2 text-xs leading-relaxed text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">
          {kind === 'customer' ? t('opening_explain_customer') : t('opening_explain_supplier')}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="ob-party">{kind === 'customer' ? t('opening_party_customer') : t('opening_party_supplier')}</Label>
          {picked ? (
            <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm" data-testid="opening-picked">
              <span className="flex items-center gap-2 font-medium"><Check className="h-4 w-4 text-green-600 dark:text-green-400" />{picked.name}{picked.phone && <span className="text-xs font-normal text-muted-foreground">{picked.phone}</span>}</span>
              <button type="button" className="text-xs text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => { setPicked(null); setQuery('') }}>{t('opening_change')}</button>
            </div>
          ) : (
            <>
              <Input id="ob-party" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('opening_search_placeholder')} autoComplete="off" data-testid="opening-party-search" />
              <ul className="divide-y rounded-lg border" data-testid="opening-party-list">
                {matches.map(p => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => setPicked(p)}>
                      <span>{p.name}</span><span className="text-xs text-muted-foreground">{p.phone}</span>
                    </button>
                  </li>
                ))}
                {newName && (
                  <li className="space-y-2 bg-muted/30 px-3 py-2">
                    <p className="flex items-center gap-2 text-sm font-medium text-stockshop-blue dark:text-blue-400"><UserPlus className="h-4 w-4" />{t('opening_new_party', { name: newName })}</p>
                    <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder={t('opening_new_phone')} inputMode="tel" className="h-9" data-testid="opening-new-phone" />
                  </li>
                )}
                {!matches.length && !newName && <li className="px-3 py-2 text-xs text-muted-foreground">{t('opening_type_name')}</li>}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-amount">{t('opening_amount', { currency: currencySymbol })}</Label>
          <Input id="ob-amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="25000" className="text-lg font-semibold tabular-nums" data-testid="opening-amount" />
        </div>

        <div className={cn('grid gap-3', kind === 'customer' ? 'sm:grid-cols-2' : '')}>
          <div className="space-y-1.5">
            <Label htmlFor="ob-date">{t('opening_debt_date')}</Label>
            <Input id="ob-date" type="date" value={debtDate} max={todayIso()} onChange={e => setDebtDate(e.target.value)} data-testid="opening-date" />
          </div>
          {kind === 'customer' && (
            <div className="space-y-1.5">
              <Label htmlFor="ob-due">{t('opening_due_date')}</Label>
              <Input id="ob-due" type="date" value={dueDate} min={debtDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-note">{t('opening_note')}</Label>
          <Textarea id="ob-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder={t('opening_note_placeholder')} />
        </div>

        {valid && (
          <p className="rounded-lg border px-3 py-2 text-sm" data-testid="opening-summary">
            {kind === 'customer' ? t('opening_summary_customer', { name: who, amount: `${value.toLocaleString()} ${currencySymbol}` }) : t('opening_summary_supplier', { name: who, amount: `${value.toLocaleString()} ${currencySymbol}` })}
          </p>
        )}
      </div>
    </FormDrawer>
  )
}
