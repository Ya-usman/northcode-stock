export const metadata = {
  title: 'Mentions légales — StockShop',
}

export default function MentionsLegalesPage() {
  return (
    <div style={{ backgroundColor: '#fff', minHeight: '100vh' }}>
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Mentions légales</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>Dernière mise à jour : {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Éditeur du site</h2>
      <p>
        Le site et l'application StockShop sont édités, à titre individuel (aucune structure juridique enregistrée à ce jour), par :
      </p>
      <ul>
        <li>Mboughue Ghislain Job</li>
        <li>Yahaya Usman</li>
      </ul>
      <p>Domiciliés à Paris, France.</p>
      <p>
        Contact : <a href="mailto:contact@stockshop.tech" style={{ color: '#073e8a' }}>contact@stockshop.tech</a>
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. Directeur de la publication</h2>
      <p>Mboughue Ghislain Job et Yahaya Usman.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. Hébergement</h2>
      <p>
        Le site web est hébergé par :<br />
        Vercel Inc. — 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis<br />
        <a href="https://vercel.com" style={{ color: '#073e8a' }}>https://vercel.com</a>
      </p>
      <p>
        La base de données et les services d'authentification sont hébergés par :<br />
        Supabase, Inc.<br />
        <a href="https://supabase.com" style={{ color: '#073e8a' }}>https://supabase.com</a>
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Propriété intellectuelle</h2>
      <p>
        L'ensemble des contenus présents sur le site et l'application StockShop (textes, logo, interface, code) est la propriété
        de ses éditeurs, sauf mention contraire. Toute reproduction non autorisée est interdite.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Données personnelles</h2>
      <p>
        Le traitement des données personnelles est détaillé dans notre{' '}
        <a href="/privacy" style={{ color: '#073e8a' }}>Politique de confidentialité</a>.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Cookies</h2>
      <p>
        L'application utilise des cookies et un stockage local strictement nécessaires à l'authentification et au
        fonctionnement du service (maintien de session). Aucun cookie publicitaire ou de traçage tiers n'est utilisé.
      </p>

      <p style={{ marginTop: 48, color: '#888', fontSize: 14 }}>© {new Date().getFullYear()} StockShop. Tous droits réservés.</p>
    </div>
    </div>
  )
}
