const fs = require('fs')

const landingEN = {
  nav: { features:'Features', pricing:'Pricing', reviews:'Reviews', login:'Log In', start_trial:'Start Free Trial' },
  hero: {
    badge:'Nigeria & Cameroon · EN · FR · HA',
    title:'Run your boutique',
    title_highlight:'smarter, not harder',
    subtitle:'The only inventory system designed for West African boutiques — track stock, record sales, manage credit, and know your numbers.',
    cta_primary:'Start Free 14-Day Trial', cta_secondary:'See Features',
    no_card:'No credit card required • Cancel anytime • Works on any phone',
    stat_shops:'Active Shops', stat_sales:'Sales Tracked', stat_rating:'Rating'
  },
  trust:{ label:'Trusted by boutiques in', cities:'Lagos · Kano · Abuja · Kaduna · Douala · Yaoundé · Bafoussam · Sokoto' },
  features:{
    title:'Everything your shop needs', subtitle:'Simple enough for any staff. Powerful enough to run a serious business.',
    f1_title:'Sales in seconds', f1_desc:'Search product name or scan barcode. Complete a sale in under 10 seconds.',
    f2_title:'Real-time stock tracking', f2_desc:'Know exactly what you have at any moment. Get alerts before running out.',
    f3_title:'Credit & debt tracker', f3_desc:'Record credit sales, track balances, and collect payments easily.',
    f4_title:'Reports & insights', f4_desc:'Daily revenue, top products, cashier performance. Know your numbers.',
    f5_title:'Multi-language', f5_desc:'Full support for English, French and Hausa. Switch language anytime.',
    f6_title:'Nigeria & Cameroon', f6_desc:'Paystack for Nigeria. MTN MoMo & Orange Money for Cameroon. Each in their own currency.'
  },
  testimonials:{
    title:'What shop owners say', rating:'4.9/5 from 200+ reviews',
    t1_name:'Alhaji Musa Ibrahim', t1_shop:'Musa General Store, Kano', t1_text:'Before NorthCode, I never knew how much I was making daily. Now I check my phone and I know everything.',
    t2_name:'Jean-Pierre Mbarga', t2_shop:'Mbarga Electronics, Douala', t2_text:'The credit tracking changed my management. Everything is recorded, no more disputes with customers.',
    t3_name:'Usman Garba', t3_shop:'Garba Electronics, Sokoto', t3_text:'My cashier uses it without any training. Very easy. The offline mode works perfectly.'
  },
  pricing:{
    title:'Simple, honest pricing', subtitle:'Start free for 14 days. No credit card required.',
    popular:'Most Popular', per_month:'/month', cta:'Start Free Trial',
    note:'All plans include 14-day free trial • Cancel anytime • No hidden fees',
    toggle_ng:'Nigeria (₦)', toggle_cm:'Cameroun (FCFA)',
    f1:'Up to 200 products', f2:'3 staff accounts', f3:'CSV & PDF export', f4:'90 days history',
    f5:'Unlimited products', f6:'10 staff accounts', f7:'WhatsApp receipts', f8:'1 year history',
    f9:'Unlimited everything', f10:'Unlimited staff', f11:'Dedicated support', f12:'Custom onboarding'
  },
  cta:{ title:'Ready to know your business numbers?', subtitle:'Join hundreds of boutiques in Nigeria and Cameroon already using NorthCode Stock.', button:'Create Free Account', note:'No credit card • Setup in 2 minutes' },
  footer:{ secure:'Secure • Private • Made in Africa', rights:'© {year} NorthCode. All rights reserved.' }
}

const landingFR = {
  nav:{ features:'Fonctionnalités', pricing:'Tarifs', reviews:'Avis', login:'Se connecter', start_trial:'Essai gratuit' },
  hero:{
    badge:'Nigeria & Cameroun · EN · FR · HA',
    title:'Gérez votre boutique',
    title_highlight:'plus intelligemment',
    subtitle:"Le seul système de gestion de stock conçu pour les boutiques d'Afrique de l'Ouest — stocks, ventes, crédits, rapports.",
    cta_primary:"Démarrer l'essai gratuit 14 jours", cta_secondary:'Voir les fonctionnalités',
    no_card:'Sans carte bancaire • Annulation à tout moment • Fonctionne sur tout téléphone',
    stat_shops:'Boutiques actives', stat_sales:'Ventes suivies', stat_rating:'Note'
  },
  trust:{ label:'Utilisé par des boutiques à', cities:'Lagos · Kano · Abuja · Kaduna · Douala · Yaoundé · Bafoussam · Sokoto' },
  features:{
    title:'Tout ce dont votre boutique a besoin', subtitle:'Assez simple pour tout employé. Assez puissant pour un vrai business.',
    f1_title:'Ventes en secondes', f1_desc:'Cherchez le produit ou scannez le code-barres. Finissez une vente en moins de 10 secondes.',
    f2_title:'Stock en temps réel', f2_desc:'Sachez exactement ce que vous avez à tout moment. Alertes avant rupture.',
    f3_title:'Suivi crédits & dettes', f3_desc:'Enregistrez les ventes à crédit, suivez les soldes, encaissez facilement.',
    f4_title:'Rapports & analyses', f4_desc:'Revenu journalier, top produits, performance caissier. Connaissez vos chiffres.',
    f5_title:'Multilingue', f5_desc:'Support complet anglais, français et haoussa. Changez de langue à tout moment.',
    f6_title:'Nigeria & Cameroun', f6_desc:'Paystack pour le Nigeria. MTN MoMo & Orange Money pour le Cameroun. Chaque pays dans sa devise.'
  },
  testimonials:{
    title:'Ce que disent les propriétaires', rating:'4,9/5 selon 200+ avis',
    t1_name:'Alhaji Musa Ibrahim', t1_shop:'Musa General Store, Kano', t1_text:'Avant NorthCode, je ne savais jamais combien je faisais par jour. Maintenant je vérifie mon téléphone et je sais tout.',
    t2_name:'Jean-Pierre Mbarga', t2_shop:'Mbarga Electronics, Douala', t2_text:'Le suivi des crédits a changé ma gestion. Tout est enregistré, plus de disputes avec les clients.',
    t3_name:'Usman Garba', t3_shop:'Garba Electronics, Sokoto', t3_text:"Mon caissier l'utilise sans formation. Très simple. Le mode hors ligne fonctionne parfaitement."
  },
  pricing:{
    title:'Tarifs simples et transparents', subtitle:'Commencez gratuitement pendant 14 jours. Sans carte bancaire.',
    popular:'Plus populaire', per_month:'/mois', cta:"Démarrer l'essai",
    note:"Tous les plans incluent 14 jours d'essai • Annulation à tout moment • Sans frais cachés",
    toggle_ng:'Nigeria (₦)', toggle_cm:'Cameroun (FCFA)',
    f1:"Jusqu'à 200 produits", f2:'3 comptes employés', f3:'Export CSV & PDF', f4:"90 jours d'historique",
    f5:'Produits illimités', f6:'10 comptes employés', f7:'Reçus WhatsApp', f8:"1 an d'historique",
    f9:'Tout illimité', f10:'Employés illimités', f11:'Support dédié', f12:'Onboarding personnalisé'
  },
  cta:{ title:'Prêt à connaître vos chiffres ?', subtitle:'Rejoignez des centaines de boutiques au Nigeria et au Cameroun qui utilisent déjà NorthCode Stock.', button:'Créer un compte gratuit', note:'Sans carte bancaire • Configuration en 2 minutes' },
  footer:{ secure:'Sécurisé • Privé • Made in Africa', rights:'© {year} NorthCode. Tous droits réservés.' }
}

const landingHA = {
  nav:{ features:'Abubuwa', pricing:'Farashi', reviews:"Ra'ayoyi", login:'Shiga', start_trial:'Fara Gwaji Kyauta' },
  hero:{
    badge:'Najeriya & Kamaru · EN · FR · HA',
    title:'Gudanar da kantin ku',
    title_highlight:'da wayo, ba da wahala ba',
    subtitle:'Tsarin kula da kaya da aka tsara don kantunan Afirka ta Yamma — kaya, sayarwa, bashi, da rahoto.',
    cta_primary:'Fara Gwaji Kyauta na Kwanaki 14', cta_secondary:'Duba Abubuwa',
    no_card:'Ba kati ba • Soke kowane lokaci • Yana aiki a kowane wayar hannu',
    stat_shops:'Kantuna masu aiki', stat_sales:'Sayarwa da aka bi', stat_rating:'Kimantawa'
  },
  trust:{ label:'Kantuna suna amfani a', cities:'Kano · Kaduna · Sokoto · Abuja · Douala · Maiduguri' },
  features:{
    title:'Duk abin da kantin ku ke bukata', subtitle:"Sauqi ga ma'aikaci kowane. Yana aiki don kasuwanci mai muhimmanci.",
    f1_title:'Sayarwa cikin dakika', f1_desc:'Nemo kaya ko duba lambar. Kammala sayarwa cikin dakika 10.',
    f2_title:'Bin diddigin kaya kai tsaye', f2_desc:'San duk abin da kuke da shi kowane lokaci. Gargadi kafin karewa.',
    f3_title:'Bin diddigin bashi', f3_desc:"Rubuta sayarwa bisa bashi, bi diddigin ma'auni, tattara kudi.",
    f4_title:'Rahoto & bayanai', f4_desc:"Kudaden yau, manyan kayayyaki, aikin ma'aikata. San lambobin kasuwancin ku.",
    f5_title:'Harsuna da yawa', f5_desc:'Turanci, Faransanci, da Hausa. Canza harshe a kowane lokaci.',
    f6_title:'Najeriya & Kamaru', f6_desc:'Paystack don Najeriya. MTN MoMo & Orange Money don Kamaru.'
  },
  testimonials:{
    title:'Abin da masu kantin suka ce', rating:'4.9/5 daga sakonnin 200+',
    t1_name:'Alhaji Musa Ibrahim', t1_shop:'Musa General Store, Kano', t1_text:'Kafin NorthCode, ban taba sanin nawa nake samu kowace rana ba. Yanzu ina duba wayata kuma na san komai.',
    t2_name:'Jean-Pierre Mbarga', t2_shop:'Mbarga Electronics, Douala', t2_text:'Bin diddigin bashi ya canza yadda nake gudanarwa. Duk ya rubuta, ba gardama da abokan ciniki.',
    t3_name:'Usman Garba', t3_shop:'Garba Electronics, Sokoto', t3_text:"Ma'aikacina yana amfani da shi ba tare da horarwa ba. Sauqi sosai."
  },
  pricing:{
    title:'Farashi mai sauki da gaskiya', subtitle:'Fara kyauta na kwanaki 14. Ba kati ba.',
    popular:'Shahararren', per_month:'/wata', cta:'Fara Gwaji Kyauta',
    note:'Duk shirye-shiryen sun hada kwanaki 14 na gwaji • Soke kowane lokaci',
    toggle_ng:'Najeriya (N)', toggle_cm:'Kamaru (FCFA)',
    f1:'Har kayayyaki 200', f2:"Asusun ma'aikata 3", f3:'Export CSV & PDF', f4:'Tarihin kwanaki 90',
    f5:'Kayayyaki marasa iyaka', f6:"Asusun ma'aikata 10", f7:'Rasidodin WhatsApp', f8:'Tarihin shekara 1',
    f9:'Komai maras iyaka', f10:"Ma'aikata marasa iyaka", f11:'Tallafi na musamman', f12:'Onboarding na musamman'
  },
  cta:{ title:'Shirye don sanin lambobin kasuwancin ku?', subtitle:'Ku shiga daruruwan kantuna a Najeriya da Kamaru da ke amfani da NorthCode Stock.', button:'Kirji Asusun Kyauta', note:'Ba kati ba • Kafa cikin minti 2' },
  footer:{ secure:'Amintacce • Mai zaman kansa • An yi a Afirka', rights:'© {year} NorthCode. Duk hakkokin an kiyaye.' }
}

;[
  ['messages/en.json', landingEN],
  ['messages/fr.json', landingFR],
  ['messages/ha.json', landingHA],
].forEach(([fname, data]) => {
  const existing = JSON.parse(fs.readFileSync(fname, 'utf8'))
  existing.landing = data
  fs.writeFileSync(fname, JSON.stringify(existing, null, 2), 'utf8')
  console.log('Updated', fname)
})
