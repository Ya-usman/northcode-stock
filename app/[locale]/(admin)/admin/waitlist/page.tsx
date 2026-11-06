export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { WaitlistAdmin, type WaitlistRow } from '@/components/admin/waitlist-admin'

// Admin → Liste d'attente (lot C, migration 217) : inscriptions des pages Métiers. La mise en page admin a déjà vérifié
// l'accès ; la table n'est lisible que par le serveur. Les 2 000 plus récentes (au-delà : export complet à prévoir).
export default async function AdminWaitlistPage() {
  const admin = await createAdminClient() as any
  const { data, error } = await admin.from('waitlist')
    .select('id, sector, sub_trade, contact, contact_kind, locale, country, signups, notified_at, created_at, updated_at')
    .order('created_at', { ascending: false }).limit(2000)
  return <WaitlistAdmin rows={(data || []) as WaitlistRow[]} loadError={error ? error.message : null} />
}
