'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '320px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>App error</h1>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem' }}>
              A critical error occurred. Your data is safe.
            </p>
            <button
              onClick={reset}
              style={{ background: '#073e8a', color: 'white', border: 'none', padding: '0.625rem 1.5rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
