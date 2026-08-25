import { createTranslator } from 'next-intl'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import ha from '@/messages/ha.json'

const CATALOGS = { fr, en, ha } as const
type ApiLocale = keyof typeof CATALOGS

function getRequestLocale(request: Request): ApiLocale {
  // Routes API vivent hors de app/[locale]/ — pas de params.locale, pas de
  // NextIntlClientProvider, donc useTranslations() ne fonctionne pas ici.
  // Même lecture ad hoc du cookie que team/invite et team/resend-invite
  // utilisaient déjà pour choisir la langue d'un lien d'invitation.
  const raw = (request.headers.get('cookie') ?? '').match(/NEXT_LOCALE=([^;]+)/)?.[1]
  return raw === 'en' || raw === 'ha' ? raw : 'fr'
}

/**
 * Traducteur pour les messages d'erreur/succès renvoyés par les routes API,
 * scopé sur le namespace `api_errors` de messages/{fr,en,ha}.json.
 * Usage: const t = getApiTranslator(request); ... NextResponse.json({ error: t('not_authenticated') })
 */
export function getApiTranslator(request: Request) {
  const locale = getRequestLocale(request)
  return createTranslator({ locale, messages: CATALOGS[locale], namespace: 'api_errors' })
}
