/** Supprime les accents et met en minuscules pour une recherche insensible aux diacritiques. */
export function normalize(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
