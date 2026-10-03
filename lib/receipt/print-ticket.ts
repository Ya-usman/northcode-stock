'use client'

import { buildSaleTicket, type TicketData } from './ticket'
import { renderTicketPdf } from './ticket-pdf'
import type { TicketPrintSettings } from './print-settings'
import { printPDFNative } from '@/lib/utils/native-share'

// Point d'entrée unique : modèle → sortie choisie dans les réglages.
//  - « system » : PDF à la largeur du rouleau → impression système (PC : boîte
//    d'impression ; Android : feuille de partage → « Imprimer »).
//  - « bluetooth » : octets ESC/POS → imprimante appairée, via le plugin natif
//    (app Android uniquement).
// Les erreurs portent un `code` (voir ticketErrorKey) pour un message traduit.
export class TicketPrintError extends Error {
  constructor(public code: 'NO_PRINTER' | 'UNAVAILABLE' | 'BLUETOOTH_OFF' | 'NO_BLUETOOTH' | 'CONNECT_FAILED' | 'PERMISSION_DENIED' | 'UNKNOWN', message?: string) {
    super(message || code)
    this.name = 'TicketPrintError'
  }
}

export async function printSaleTicket(args: { data: TicketData; settings: TicketPrintSettings; fileName: string }): Promise<void> {
  const lines = buildSaleTicket(args.data, args.settings.width)
  if (args.settings.method === 'bluetooth') {
    if (!args.settings.bluetoothAddress) throw new TicketPrintError('NO_PRINTER')
    const [{ encodeTicketEscPos }, { BluetoothPrinter, bytesToBase64 }] = await Promise.all([
      import('./ticket-escpos'),
      import('./bluetooth-printer'),
    ])
    const bytes = await encodeTicketEscPos(lines, args.settings.width)
    try {
      await BluetoothPrinter.print({ address: args.settings.bluetoothAddress, data: bytesToBase64(bytes) })
    } catch (err: any) {
      const code = err?.code
      if (code === 'UNAVAILABLE' || code === 'BLUETOOTH_OFF' || code === 'NO_BLUETOOTH' || code === 'CONNECT_FAILED' || code === 'PERMISSION_DENIED') {
        throw new TicketPrintError(code, err?.message)
      }
      // Plugin natif absent de l'APK (vieille version) : Capacitor répond « not implemented »
      if (/not implemented|UNIMPLEMENTED/i.test(String(err?.message || err?.code))) throw new TicketPrintError('UNAVAILABLE', err?.message)
      throw new TicketPrintError('UNKNOWN', err?.message)
    }
    return
  }
  const blob = await renderTicketPdf(lines, args.settings.width)
  await printPDFNative(blob, args.fileName)
}

/** Clé i18n (espace de noms `settings`) du message à afficher pour une erreur d'impression. */
export function ticketErrorKey(err: unknown): string {
  const code = (err as any)?.code
  switch (code) {
    case 'NO_PRINTER': return 'settings.ticket_err_no_printer'
    case 'UNAVAILABLE': return 'settings.ticket_err_app_only'
    case 'BLUETOOTH_OFF': return 'settings.ticket_err_bluetooth_off'
    case 'NO_BLUETOOTH': return 'settings.ticket_err_no_bluetooth'
    case 'CONNECT_FAILED': return 'settings.ticket_err_connect'
    case 'PERMISSION_DENIED': return 'settings.ticket_err_permission'
    default: return 'settings.ticket_err_unknown'
  }
}
