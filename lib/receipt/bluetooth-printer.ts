'use client'

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Pont JS du plugin natif maison `BluetoothPrinter`
// (android/app/src/main/java/com/northcode/stockshop/BluetoothPrinterPlugin.java) :
// imprimantes thermiques Bluetooth classique (SPP). Sur le web (PWA, PC), le
// plugin n'existe pas : l'implémentation ci-dessous répond « indisponible »
// proprement au lieu de planter.

export interface PairedDevice {
  name: string
  address: string
  /** Classe Bluetooth majeure ; 0x600 = IMAGING (imprimantes, scanners). */
  majorClass?: number
}

export interface BluetoothPrinterPlugin {
  isAvailable(): Promise<{ available: boolean; enabled: boolean }>
  listPaired(): Promise<{ devices: PairedDevice[] }>
  /** `data` : octets ESC/POS encodés en base64. */
  print(options: { address: string; data: string }): Promise<void>
  openSettings(): Promise<void>
  addListener?(eventName: string, listener: (...args: any[]) => void): Promise<PluginListenerHandle>
}

export const BLUETOOTH_IMAGING_CLASS = 0x600

class BluetoothPrinterWeb implements BluetoothPrinterPlugin {
  async isAvailable() { return { available: false, enabled: false } }
  async listPaired(): Promise<{ devices: PairedDevice[] }> { throw unavailable() }
  async print(): Promise<void> { throw unavailable() }
  async openSettings(): Promise<void> { throw unavailable() }
}

function unavailable() {
  const e = new Error('BLUETOOTH_UNAVAILABLE_ON_WEB') as Error & { code?: string }
  e.code = 'UNAVAILABLE'
  return e
}

export const BluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter', {
  web: () => new BluetoothPrinterWeb(),
})

/** Octets → base64 (navigateur, sans Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(s)
}
