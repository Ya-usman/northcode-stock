'use client'

// Bouton « Me prévenir » d'une carte métier : choisit le métier dans le formulaire de la liste d'attente puis y mène.
import type { WaitlistSector } from '@/lib/site/waitlist'

export const WAITLIST_PICK_EVENT = 'stockshop:waitlist-pick'

export function NotifyButton({ sector, label, className = 'link' }: { sector: WaitlistSector; label: string; className?: string }) {
  return (
    <button type="button" className={className} data-testid={`notify-${sector}`} onClick={() => {
      window.dispatchEvent(new CustomEvent(WAITLIST_PICK_EVENT, { detail: sector }))
      const target = document.getElementById('liste')
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      window.setTimeout(() => target?.querySelector<HTMLElement>('[data-testid="waitlist-contact"]')?.focus({ preventScroll: true }), 450)
    }}>{label}</button>
  )
}
