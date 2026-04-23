export const metadata = {
  title: 'Privacy Policy — StockShop',
}

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', fontFamily: 'sans-serif', color: '#111', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>Last updated: April 23, 2026</p>

      <p>StockShop ("the App") is developed and operated by NorthCode. This Privacy Policy explains how we collect, use, and protect your information when you use our mobile and web application.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Information We Collect</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address, and password when you register.</li>
        <li><strong>Shop information:</strong> shop name, city, phone number, and country.</li>
        <li><strong>Usage data:</strong> sales, inventory, customer and supplier records you enter into the app.</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. Camera Permission</h2>
      <p>The app requests access to your device camera solely for the purpose of scanning barcodes and QR codes to add or look up products. We do not capture, store, or transmit any photos or video from your camera.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. How We Use Your Information</h2>
      <ul>
        <li>To provide and operate the StockShop service.</li>
        <li>To authenticate your account and keep it secure.</li>
        <li>To display your business data within the app.</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Data Sharing</h2>
      <p>We do not sell, rent, or share your personal data with any third parties. Your data is only accessible to you and authorized members of your team within the app.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Data Storage & Security</h2>
      <p>All data is stored securely on Supabase cloud servers with encryption in transit (HTTPS) and at rest. We follow industry best practices to protect your information.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Data Retention</h2>
      <p>Your data is retained as long as your account is active. You may request deletion of your account and all associated data by contacting us.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>7. Children's Privacy</h2>
      <p>StockShop is intended for users aged 18 and above. We do not knowingly collect data from children under 13.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>8. Contact Us</h2>
      <p>If you have any questions about this Privacy Policy, please contact us at:<br />
        <a href="mailto:yahaya.dev@gmail.com" style={{ color: '#073e8a' }}>yahaya.dev@gmail.com</a>
      </p>

      <p style={{ marginTop: 48, color: '#888', fontSize: 14 }}>© {new Date().getFullYear()} NorthCode · StockShop. All rights reserved.</p>
    </div>
  )
}
