// Type RÉEL d'une image, lu dans ses premiers octets (signature) — jamais le type MIME annoncé par le
// navigateur ni l'extension du nom de fichier, qui sont libres. Serveur uniquement.

export type SniffedImage = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; ext: 'jpg' | 'png' | 'webp' | 'gif' }

export function sniffImage(buf: Uint8Array): SniffedImage | null {
  const b = (i: number) => buf[i]
  const ascii = (from: number, len: number) => String.fromCharCode(...Array.from(buf.subarray(from, from + len)))
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 8 && b(0) === 0x89 && ascii(1, 3) === 'PNG' && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  if (buf.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { mime: 'image/gif', ext: 'gif' }
  return null
}
