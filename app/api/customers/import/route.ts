import { handleContactImport } from '@/lib/api/contact-import'

// Import de fiches (vérification dry_run, puis import) — voir lib/api/contact-import.ts
export async function POST(request: Request) {
  return handleContactImport(request, 'customers')
}
