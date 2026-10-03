// Lien public du reçu : stockshop.tech/r/<jeton> (page app/r/[token]).
// Le jeton (sales.receipt_token, migration 150) vient de la base pour une
// vente en ligne ; hors ligne, l'app le tire ici avant d'imprimer le QR et la
// synchro l'insère tel quel — même lien avant et après synchronisation.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const RECEIPT_TOKEN_RE = /^[a-z0-9]{16}$/

/** 16 caractères [a-z0-9] tirés au hasard cryptographique (≈ 82 bits). */
export function generateReceiptToken(): string {
  const out: string[] = []
  const buf = new Uint8Array(32)
  while (out.length < 16) {
    crypto.getRandomValues(buf)
    // Rejet des octets ≥ 252 (= 7 × 36) : tirage uniforme, sans biais modulo
    for (let i = 0; i < buf.length && out.length < 16; i++) {
      if (buf[i] < 252) out.push(ALPHABET[buf[i] % 36])
    }
  }
  return out.join('')
}

/** Domaine public (stockshop.tech en production ; NEXT_PUBLIC_APP_URL si défini). */
export function receiptBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://stockshop.tech').replace(/\/+$/, '')
}

/** URL complète du reçu, ou null si la vente n'a pas (encore) de jeton valide. */
export function receiptUrl(token: string | null | undefined): string | null {
  return token && RECEIPT_TOKEN_RE.test(token) ? `${receiptBaseUrl()}/r/${token}` : null
}

/** Forme lisible à imprimer en clair (« stockshop.tech/r/… »). */
export function receiptUrlShort(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
