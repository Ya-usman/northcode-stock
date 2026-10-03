import { NextResponse } from 'next/server'

// Politique de mise à jour de l'app Android, pilotée par les variables Vercel :
//   MIN_ANDROID_VERSION_CODE    — en dessous : mise à jour OBLIGATOIRE (écran
//                                 bloquant / flux Play « immédiat »). 0 = jamais.
//   LATEST_ANDROID_VERSION_CODE — dernière version publiée : les téléphones
//                                 sans le plugin Play (≤ 2.18.0) affichent le
//                                 bandeau « Nouvelle version disponible » et
//                                 vont au Play Store ; à partir de 2.19.0, Google
//                                 Play est la source de vérité (In-App Updates)
//                                 et cette valeur ne sert que de repli.
// À mettre à jour à chaque release : LATEST = versionCode publié, MIN seulement
// si une version casse la compatibilité (plugin natif requis…).
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    min_version_code: parseInt(process.env.MIN_ANDROID_VERSION_CODE || '0', 10),
    latest_version_code: parseInt(process.env.LATEST_ANDROID_VERSION_CODE || '0', 10),
    app_id: 'com.northcode.stockshop',
    store_url: 'https://play.google.com/store/apps/details?id=com.northcode.stockshop',
  })
}
