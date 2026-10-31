// Noms courts des boutiques côté SERVEUR (titres des notifications, migration 191) : nom court choisi, sinon règle
// automatique (nom de l'entreprise retiré en tête), sinon nom complet. Avant la 191 (colonne absente) : règle seule.
import { shortShopName } from '@/lib/shops/short-name'

export async function shopShortLabels(admin: any, ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return {}
  let rows: any[] | null = null
  const withShort = await admin.from('shops').select('id, name, short_name, entity_id').in('id', unique)
  rows = withShort.error ? null : withShort.data
  if (!rows) rows = (await admin.from('shops').select('id, name, entity_id').in('id', unique)).data || []
  const entityIds = Array.from(new Set((rows as any[]).map(r => r.entity_id).filter(Boolean)))
  const { data: ents } = entityIds.length ? await admin.from('entities').select('id, name').in('id', entityIds) : { data: [] }
  const entityName = new Map<string, string>((ents || []).map((e: any) => [e.id, e.name]))
  const out: Record<string, string> = {}
  for (const r of rows as any[]) out[r.id] = shortShopName(r.name, r.entity_id ? entityName.get(r.entity_id) : null, r.short_name)
  return out
}
