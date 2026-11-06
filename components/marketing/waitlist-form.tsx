'use client'

// Formulaire de la liste d'attente (lot C) : activité (ou métier fixé par la page), établissement facultatif, e-mail ou
// téléphone. Contrôle immédiat du contact (mêmes règles que le serveur, lib/site/waitlist). Hors connexion : message
// clair, la saisie reste, « Réessayer ». Champ piège invisible pour les robots (le serveur n'enregistre rien s'il est
// rempli). Textes passés par le serveur.
import { useEffect, useState } from 'react'
import { normalizeContact, WAITLIST_SUB_TRADES, type WaitlistSector } from '@/lib/site/waitlist'
import { WAITLIST_PICK_EVENT } from './waitlist-bits'

export interface WaitlistLabels {
  sector_label: string; sub_label: string; choose: string; contact_label: string; contact_placeholder: string
  submit: string; sending: string; retry: string; note: string; done_title: string; done_text: string
  err_contact: string; err_sector: string; err_offline: string; err_server: string; err_limit: string
  sectors: Record<string, string>; subs: Record<string, string>
}

type Status = 'idle' | 'sending' | 'done' | 'err_contact' | 'err_sector' | 'err_offline' | 'err_server' | 'err_limit'

export function WaitlistForm({ locale, labels, sectors, fixedSector, initialSector }: {
  locale: string; labels: WaitlistLabels; sectors?: WaitlistSector[]; fixedSector?: WaitlistSector; initialSector?: WaitlistSector
}) {
  const [sector, setSector] = useState<string>(fixedSector ?? initialSector ?? '')
  const [sub, setSub] = useState('')
  const [contact, setContact] = useState('')
  const [trap, setTrap] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  // « Me prévenir » d'une carte métier : le métier est choisi ici (pas sur une page au métier fixé)
  useEffect(() => {
    if (fixedSector) return
    const onPick = (e: Event) => { const v = (e as CustomEvent).detail; if (!sectors || sectors.includes(v)) { setSector(v); setSub(''); setStatus(s => (s === 'done' ? s : 'idle')) } }
    window.addEventListener(WAITLIST_PICK_EVENT, onPick)
    return () => window.removeEventListener(WAITLIST_PICK_EVENT, onPick)
  }, [fixedSector, sectors])
  const subs = sector ? WAITLIST_SUB_TRADES[sector as WaitlistSector] : undefined

  const send = async () => {
    if (!sector) return setStatus('err_sector')
    if (!normalizeContact(contact)) return setStatus('err_contact')
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setStatus('err_offline')
    setStatus('sending')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, sub_trade: sub || null, contact, locale, website: trap }),
      })
      if (res.ok) return setStatus('done')
      if (res.status === 429) return setStatus('err_limit')
      const j = await res.json().catch(() => null)
      if (j?.error === 'invalid_contact') return setStatus('err_contact')
      setStatus('err_server')
    } catch {
      setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'err_offline' : 'err_server')
    }
  }

  if (status === 'done') {
    return (
      <div className="wl-done" role="status" data-testid="waitlist-done">
        <strong>{labels.done_title}</strong>
        <span>{labels.done_text.replace('{sector}', labels.sectors[sector] ?? sector)}</span>
      </div>
    )
  }

  const error = status.startsWith('err_') ? labels[status as keyof WaitlistLabels] as string : null
  return (
    <form className="wl-form" noValidate onSubmit={e => { e.preventDefault(); send() }} data-testid="waitlist-form">
      <div className="wl-fields">
        {!fixedSector && sectors && (
          <label className="wl-field">
            <span>{labels.sector_label}</span>
            <select value={sector} onChange={e => { setSector(e.target.value); setSub(''); if (status === 'err_sector') setStatus('idle') }} aria-invalid={status === 'err_sector'} data-testid="waitlist-sector">
              <option value="">{labels.choose}</option>
              {sectors.map(s => <option key={s} value={s}>{labels.sectors[s]}</option>)}
            </select>
          </label>
        )}
        {subs && (
          <label className="wl-field">
            <span>{labels.sub_label}</span>
            <select value={sub} onChange={e => setSub(e.target.value)} data-testid="waitlist-sub">
              <option value="">{labels.choose}</option>
              {subs.map(s => <option key={s} value={s}>{labels.subs[s]}</option>)}
            </select>
          </label>
        )}
        <label className="wl-field wl-contact">
          <span>{labels.contact_label}</span>
          <input type="text" inputMode="email" autoComplete="email" value={contact} placeholder={labels.contact_placeholder}
            onChange={e => { setContact(e.target.value); if (status === 'err_contact') setStatus('idle') }}
            aria-invalid={status === 'err_contact'} aria-describedby="wl-msg" data-testid="waitlist-contact" />
        </label>
        {/* Champ piège : invisible et hors du parcours clavier, jamais rempli par une personne */}
        <input type="text" name="website" value={trap} onChange={e => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="wl-trap" />
        <button type="submit" className="btn btn-cta" disabled={status === 'sending'} data-testid="waitlist-submit">
          {status === 'sending' ? labels.sending : (status === 'err_offline' || status === 'err_server') ? labels.retry : labels.submit}
        </button>
      </div>
      <p id="wl-msg" className={error ? 'wl-error' : 'wl-note'} role={error ? 'alert' : undefined} data-testid="waitlist-message">{error ?? labels.note}</p>
    </form>
  )
}
