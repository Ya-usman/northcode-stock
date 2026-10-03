// Réglages d'impression des tickets — PAR APPAREIL (localStorage), pas par
// boutique : deux caisses d'une même boutique n'ont pas la même imprimante.
import type { TicketWidth } from './ticket'

export type TicketPrintMethod = 'system' | 'bluetooth' | 'network'

export interface TicketPrintSettings {
  /** « system » (PDF → impression système), « bluetooth » (ESC/POS SPP, app Android) ; « network » à venir. */
  method: TicketPrintMethod
  width: TicketWidth
  /** Imprimer dès que la vente est validée. */
  autoPrint: boolean
  /** Imprimante Bluetooth choisie (adresse MAC) et son nom d'affichage. */
  bluetoothAddress?: string
  bluetoothName?: string
}

const KEY = 'ticket_print_v1'

export const DEFAULT_TICKET_SETTINGS: TicketPrintSettings = { method: 'system', width: 80, autoPrint: false }

export function readTicketSettings(): TicketPrintSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_TICKET_SETTINGS }
    const p = JSON.parse(raw)
    return {
      method: p.method === 'bluetooth' || p.method === 'network' ? p.method : 'system',
      width: p.width === 58 ? 58 : 80,
      autoPrint: p.autoPrint === true,
      bluetoothAddress: typeof p.bluetoothAddress === 'string' ? p.bluetoothAddress : undefined,
      bluetoothName: typeof p.bluetoothName === 'string' ? p.bluetoothName : undefined,
    }
  } catch {
    return { ...DEFAULT_TICKET_SETTINGS }
  }
}

export function writeTicketSettings(s: TicketPrintSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* stockage indisponible : réglages non persistés */ }
}
