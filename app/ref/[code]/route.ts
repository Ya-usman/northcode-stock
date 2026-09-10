import { NextResponse, type NextRequest } from 'next/server'
import { locales, defaultLocale } from '@/i18n'

// GET /ref/CODE — lien de partage court (stockshop.tech/ref/GHISLAIN24).
// Conserve le code (cookie, 30 jours) et redirige vers l'inscription, qui
// le pré-remplit et le valide via /api/referral/validate (même route que
// la saisie manuelle — un seul chemin de validation, voir point 8/9 de la
// demande). La validation d'existence réelle se fait là, pas ici : un
// aller-retour DB de plus sur un lien marketing n'apporte rien si le code
// est invalide, le formulaire d'inscription l'indique déjà clairement.
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const code = (params.code || '').trim().toUpperCase().slice(0, 20)

  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value
  const locale = cookieLocale && locales.includes(cookieLocale as any) ? cookieLocale : defaultLocale

  const url = new URL(`/${locale}/register`, request.url)
  if (code) url.searchParams.set('ref', code)

  const res = NextResponse.redirect(url)
  if (code) {
    res.cookies.set('referral_code', code, {
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
      sameSite: 'lax',
      httpOnly: false, // lu côté client par la page d'inscription
    })
  }
  return res
}
