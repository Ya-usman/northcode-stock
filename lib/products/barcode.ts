// Code-barres d'un produit (champ « SKU / Code-barres ») — règle PURE partagée par le
// formulaire, l'import et le serveur (7 oct. 2026) :
//  · avec des lettres (SUGAR-50, SKU-0044) : référence maison, acceptée ;
//  · uniquement des chiffres : doit être un vrai code-barres — 8, 12, 13 ou 14 chiffres
//    (EAN-8, UPC-A, EAN-13, GTIN-14) avec un chiffre de contrôle juste ; un chiffre de
//    contrôle faux (faute de frappe, scan mal lu) est refusé ; une autre longueur
//    (« 50 » tapé pour « 50 kg ») demande une confirmation (référence maison ?).

export type BarcodeKind = 'empty' | 'reference' | 'gtin' | 'gtin_invalid' | 'numeric_nonstandard'

const GTIN_LENGTHS = [8, 12, 13, 14]

/** Chiffre de contrôle GS1 (EAN-8, UPC-A, EAN-13, GTIN-14) : poids 3 et 1 en partant de la droite */
export function gtinCheckDigitOk(code: string): boolean {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.includes(code.length)) return false
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export function classifyBarcode(value: string | null | undefined): BarcodeKind {
  const code = (value ?? '').trim()
  if (!code) return 'empty'
  if (!/^\d+$/.test(code)) return 'reference'
  if (GTIN_LENGTHS.includes(code.length)) return gtinCheckDigitOk(code) ? 'gtin' : 'gtin_invalid'
  return 'numeric_nonstandard'
}
