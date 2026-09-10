// Génère un code de parrainage unique du type "GHISLAIN24" — basé sur le
// prénom de l'utilisateur + un suffixe numérique, avec repli sur un code
// entièrement aléatoire en cas d'échecs répétés (nom vide, collisions).
//
// Vérifie l'unicité contre referral_codes ET agents.referral_code — les
// deux systèmes de parrainage partagent le même espace de codes pour
// qu'un code affiché/partagé ne puisse jamais désigner deux choses
// différentes (voir migration 127).
const COMBINING_DIACRITICS = /[̀-ͯ]/g

function sanitizeBase(fullName: string): string {
  return (fullName || '')
    .normalize('NFD').replace(COMBINING_DIACRITICS, '') // accents
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

function randomDigits(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10)
  return out
}

function randomAlnum(n: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sans caractères ambigus (0/O, 1/I)
  let out = ''
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

async function codeExists(admin: any, code: string): Promise<boolean> {
  const [{ data: rc }, { data: ag }] = await Promise.all([
    admin.from('referral_codes').select('id').eq('code', code).maybeSingle(),
    admin.from('agents').select('id').eq('referral_code', code).maybeSingle(),
  ])
  return !!rc || !!ag
}

export async function generateUniqueReferralCode(admin: any, fullName: string): Promise<string> {
  const base = sanitizeBase(fullName)

  // 1. Nom + 2 chiffres (ex: GHISLAIN24)
  if (base.length >= 3) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${base}${randomDigits(2)}`
      if (!(await codeExists(admin, code))) return code
    }
  }

  // 2. Repli : code aléatoire (nom trop court, ou trop de collisions)
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomAlnum(8)
    if (!(await codeExists(admin, code))) return code
  }

  throw new Error('unable_to_generate_referral_code')
}
