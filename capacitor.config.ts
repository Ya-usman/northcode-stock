import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.northcode.stockshop',
  appName: 'StockShop',
  webDir: 'out',
  server: {
    // URL de production Vercel — à mettre à jour après déploiement
    // Ex: url: 'https://stockshop.vercel.app'
    // Pour tester en local, commenter la ligne url et décommenter :
    // url: 'http://192.168.x.x:3000',  // IP locale de ta machine
    url: 'https://northcode-stock.vercel.app/',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // true en dev, false en prod
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
