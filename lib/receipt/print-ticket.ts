'use client'

import { buildSaleTicket, type TicketData } from './ticket'
import { renderTicketPdf } from './ticket-pdf'
import type { TicketPrintSettings } from './print-settings'
import { printPDFNative } from '@/lib/utils/native-share'

// Point d'entrée unique : modèle → sortie choisie dans les réglages.
// Phase 1 : impression système (PC : boîte d'impression du navigateur ;
// Android : feuille de partage → « Imprimer »). Les sorties Bluetooth et
// réseau (ESC/POS) se brancheront ici sans toucher au modèle.
export async function printSaleTicket(args: { data: TicketData; settings: TicketPrintSettings; fileName: string }): Promise<void> {
  const lines = buildSaleTicket(args.data, args.settings.width)
  const blob = await renderTicketPdf(lines, args.settings.width)
  await printPDFNative(blob, args.fileName)
}
