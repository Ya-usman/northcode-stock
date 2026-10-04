import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.northcode.stockshop', // identifiant publié sur le Play Store (= applicationId de android/app/build.gradle)
  appName: 'StockShop',
  webDir: 'out',
  server: {
    // URL de production Vercel — à mettre à jour après déploiement
    // Ex: url: 'https://stockshop.vercel.app'
    // Pour tester en local, commenter la ligne url et décommenter :
    // url: 'http://192.168.x.x:3000',  // IP locale de ta machine
    url: 'https://stockshop.tech',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    // Ne jamais repasser à true : Capacitor remplacerait alors la connexion de
    // saisie de Chromium par une connexion factice (BaseInputConnection), et le
    // clavier ne verrait plus un champ éditable → plus de suggestions ni
    // d'autocorrection, plus de presse-papiers Gboard, plus de saisie par
    // glissement. Contournement d'un vieux bug de claviers Android, sans objet.
    captureInput: false,
    webContentsDebuggingEnabled: false, // true en dev, false en prod
  },
  ios: {
    // Required for service workers to intercept navigation on iOS WKWebView
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#073e8a',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#073e8a',
    },
  },
}

export default config
