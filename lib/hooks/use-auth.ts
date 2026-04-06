'use client'

// Re-export the singleton context hook — all pages that call useAuth()
// now share the single AuthProvider subscription instead of each creating their own.
export { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
