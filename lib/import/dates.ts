// Lecture d'une date venue d'un fichier d'import (Excel ou CSV) — UNE seule règle pour
// tous les imports (dettes des clients, péremption des produits).
// Acceptés : AAAA-MM-JJ (cellule date d'Excel), JJ/MM/AAAA, JJ-MM-AA, JJ.MM.AAAA,
// numéro de série Excel. Une date impossible (31/02) est refusée, jamais corrigée.

export function parseImportDate(v: unknown): { value: string | null; invalid: boolean } {
  if (v === null || v === undefined || v === '') return { value: null, invalid: false }
  const ok = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990) return { value: null, invalid: true }
    return { value: dt.toISOString().slice(0, 10), invalid: false }
  }
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return { value: null, invalid: true } // numéro de série Excel (1982 → 2119)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return ok(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = String(v).trim()
  if (!s) return { value: null, invalid: false }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return ok(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  if (/^\d{5}$/.test(s)) return parseImportDate(Number(s))
  return { value: null, invalid: true }
}
