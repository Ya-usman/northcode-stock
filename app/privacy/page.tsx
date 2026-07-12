import { cookies, headers } from 'next/headers'

export const metadata = {
  title: 'Privacy Policy — StockShop',
}

type Lang = 'en' | 'fr' | 'ha'

interface Section {
  heading: string
  paragraphs?: string[]
  list?: string[]
}

interface PrivacyContent {
  title: string
  updated: string
  intro: string
  sections: Section[]
  contactIntro: string
  rights: string
}

const CONTENT: Record<Lang, PrivacyContent> = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: April 23, 2026',
    intro: 'StockShop ("the App") is developed and operated by StockShop. This Privacy Policy explains how we collect, use, and protect your information when you use our mobile and web application.',
    sections: [
      {
        heading: '1. Information We Collect',
        list: [
          'Account information: name, email address, and password when you register.',
          'Shop information: shop name, city, phone number, and country.',
          'Usage data: sales, inventory, customer and supplier records you enter into the app.',
        ],
      },
      {
        heading: '2. Camera Permission',
        paragraphs: ['The app requests access to your device camera solely for the purpose of scanning barcodes and QR codes to add or look up products. We do not capture, store, or transmit any photos or video from your camera.'],
      },
      {
        heading: '3. How We Use Your Information',
        list: [
          'To provide and operate the StockShop service.',
          'To authenticate your account and keep it secure.',
          'To display your business data within the app.',
        ],
      },
      {
        heading: '4. Data Sharing',
        paragraphs: ['We do not sell, rent, or share your personal data with any third parties. Your data is only accessible to you and authorized members of your team within the app.'],
      },
      {
        heading: '5. Data Storage & Security',
        paragraphs: ['All data is stored securely on Supabase cloud servers with encryption in transit (HTTPS) and at rest. We follow industry best practices to protect your information.'],
      },
      {
        heading: '6. Data Retention',
        paragraphs: ['Your data is retained as long as your account is active. You may request deletion of your account and all associated data by contacting us.'],
      },
      {
        heading: "7. Children's Privacy",
        paragraphs: ['StockShop is intended for users aged 18 and above. We do not knowingly collect data from children under 13.'],
      },
      {
        heading: '8. Contact Us',
        paragraphs: [],
      },
    ],
    contactIntro: 'If you have any questions about this Privacy Policy, please contact us at:',
    rights: '© {year} StockShop. All rights reserved.',
  },
  fr: {
    title: 'Politique de confidentialité',
    updated: 'Dernière mise à jour : 23 avril 2026',
    intro: 'StockShop (« l\'Application ») est développée et exploitée par StockShop. Cette politique de confidentialité explique comment nous collectons, utilisons et protégeons vos informations lorsque vous utilisez notre application mobile et web.',
    sections: [
      {
        heading: '1. Informations que nous collectons',
        list: [
          'Informations de compte : nom, adresse e-mail et mot de passe lors de votre inscription.',
          'Informations sur la boutique : nom de la boutique, ville, numéro de téléphone et pays.',
          "Données d'utilisation : ventes, stock, clients et fournisseurs que vous enregistrez dans l'application.",
        ],
      },
      {
        heading: '2. Autorisation caméra',
        paragraphs: ["L'application demande l'accès à la caméra de votre appareil uniquement pour scanner des codes-barres et QR codes afin d'ajouter ou de rechercher des produits. Nous ne capturons, ne stockons ni ne transmettons aucune photo ou vidéo depuis votre caméra."],
      },
      {
        heading: '3. Comment nous utilisons vos informations',
        list: [
          'Pour fournir et faire fonctionner le service StockShop.',
          'Pour authentifier votre compte et le sécuriser.',
          "Pour afficher les données de votre activité au sein de l'application.",
        ],
      },
      {
        heading: '4. Partage des données',
        paragraphs: ["Nous ne vendons, ne louons ni ne partageons vos données personnelles avec des tiers. Vos données ne sont accessibles qu'à vous et aux membres autorisés de votre équipe au sein de l'application."],
      },
      {
        heading: '5. Stockage et sécurité des données',
        paragraphs: ['Toutes les données sont stockées de façon sécurisée sur les serveurs cloud de Supabase, chiffrées en transit (HTTPS) et au repos. Nous suivons les meilleures pratiques du secteur pour protéger vos informations.'],
      },
      {
        heading: '6. Conservation des données',
        paragraphs: ['Vos données sont conservées tant que votre compte est actif. Vous pouvez demander la suppression de votre compte et de toutes les données associées en nous contactant.'],
      },
      {
        heading: '7. Confidentialité des mineurs',
        paragraphs: ["StockShop est destinée aux utilisateurs âgés de 18 ans et plus. Nous ne collectons pas sciemment de données auprès d'enfants de moins de 13 ans."],
      },
      {
        heading: '8. Nous contacter',
        paragraphs: [],
      },
    ],
    contactIntro: 'Pour toute question concernant cette politique de confidentialité, contactez-nous à :',
    rights: '© {year} StockShop. Tous droits réservés.',
  },
  ha: {
    title: 'Manufar Sirri',
    updated: 'An sabunta na ƙarshe: 23 ga Afrilu, 2026',
    intro: 'StockShop ("Manhajar") ana haɓaka ta kuma sarrafa ta ta StockShop. Wannan Manufar Sirri ta bayyana yadda muke tattarawa, amfani, da kare bayananku lokacin da kuke amfani da manhajarmu ta wayar hannu da yanar gizo.',
    sections: [
      {
        heading: '1. Bayanan da Muke Tattarawa',
        list: [
          'Bayanan asusu: suna, adireshin imel, da kalmar sirri lokacin yin rajista.',
          'Bayanan shago: sunan shago, birni, lambar waya, da ƙasa.',
          'Bayanan amfani: sayarwa, kaya, abokan ciniki da masu samar da kaya da kuka shigar a cikin manhajar.',
        ],
      },
      {
        heading: '2. Izinin Kamara',
        paragraphs: ["Manhajar tana neman izinin amfani da kamarar na'urarku kawai don duba lambobin bar-code da QR don ƙara ko neman kayayyaki. Ba mu ɗauka, ajiyewa, ko aikawa da wani hoto ko bidiyo daga kamararku."],
      },
      {
        heading: '3. Yadda Muke Amfani da Bayananku',
        list: [
          'Don samar da aiki da hidimar StockShop.',
          'Don tabbatar da asusunku da kiyaye shi lafiya.',
          'Don nuna bayanan kasuwancinku a cikin manhajar.',
        ],
      },
      {
        heading: '4. Raba Bayanai',
        paragraphs: ["Ba ma sayarwa, hayarwa, ko raba bayananku na sirri da wani ɓangare na uku. Bayananku ba za a iya samu ba sai daga gare ku da ma'aikatan ƙungiyarku da aka ba izini a cikin manhajar."],
      },
      {
        heading: '5. Ajiya da Tsaron Bayanai',
        paragraphs: ['Ana ajiye duk bayanai lafiya a sabar girgije na Supabase, tare da ɓoyewa yayin tafiya (HTTPS) da lokacin ajiya. Muna bin mafi kyawun ayyuka na masana\'antu don kare bayananku.'],
      },
      {
        heading: '6. Riƙe Bayanai',
        paragraphs: ["Ana riƙe bayananku muddin asusunku na aiki. Kuna iya neman a share asusunku da duk bayanan da ke tattare da shi ta hanyar tuntuɓarmu."],
      },
      {
        heading: '7. Sirrin Yara',
        paragraphs: ["StockShop na don masu amfani 'yan shekaru 18 zuwa sama. Ba ma tattara bayanai daga yara 'yan ƙasa da shekaru 13 da sani."],
      },
      {
        heading: '8. Tuntuɓe Mu',
        paragraphs: [],
      },
    ],
    contactIntro: 'Idan kuna da tambaya game da wannan Manufar Sirri, tuntuɓe mu a:',
    rights: '© {year} StockShop. Duk hakkokin an kiyaye.',
  },
}

function resolveLang(): Lang {
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value
  if (cookieLocale === 'fr' || cookieLocale === 'en' || cookieLocale === 'ha') return cookieLocale

  const acceptLang = headers().get('accept-language') || ''
  const browserLang = acceptLang.split(',')[0]?.split('-')[0]?.toLowerCase()
  if (browserLang === 'fr' || browserLang === 'en' || browserLang === 'ha') return browserLang as Lang

  return 'en' // matches the app's own defaultLocale (i18n.ts)
}

export default function PrivacyPage() {
  const lang = resolveLang()
  const c = CONTENT[lang]
  const year = new Date().getFullYear()

  return (
    <div style={{ backgroundColor: '#fff', minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{c.title}</h1>
        <p style={{ color: '#666', marginBottom: 32 }}>{c.updated}</p>

        <p>{c.intro}</p>

        {c.sections.map((s, i) => (
          <div key={i}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>{s.heading}</h2>
            {s.paragraphs?.map((p, j) => <p key={j}>{p}</p>)}
            {s.list && (
              <ul>
                {s.list.map((li, j) => <li key={j}>{li}</li>)}
              </ul>
            )}
          </div>
        ))}

        <p>
          {c.contactIntro}<br />
          <a href="mailto:contact@stockshop.tech" style={{ color: '#073e8a' }}>contact@stockshop.tech</a>
        </p>

        <p style={{ marginTop: 48, color: '#888', fontSize: 14 }}>{c.rights.replace('{year}', String(year))}</p>
      </div>
    </div>
  )
}
