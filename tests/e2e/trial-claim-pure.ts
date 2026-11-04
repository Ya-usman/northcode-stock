// Protection de l'essai gratuit (tarification, étape 4A-2a, migration 213) : règle unique lib/saas/trial-claim,
// écritures lib/saas/trial-claim-server (base FACTICE en mémoire, aucune écriture réelle) et branchements.
// Usage : npx tsx tests/e2e/trial-claim-pure.ts
import { readFileSync } from 'fs'
import { normalizePhone, nameCityKey, decideTrial, recentOthers, cleanDeviceId, trialEnd, TRIAL_DAYS, CLAIM_WINDOW_DAYS } from '../../lib/saas/trial-claim'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const NOW = new Date('2026-11-04T12:00:00Z')
const DAY = 86_400_000
const iso = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString()
const src = (p: string) => readFileSync(p, 'utf8')

// Base factice : trial_claims (lecture par empreinte, insertion) et entities (mise à jour)
function fakeAdmin(claims: any[] = [], opts: { claimsError?: boolean; noTrialStatus?: boolean } = {}) {
  const entities: Record<string, any> = {}
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select', values: any = null
    const filters: { col: string; vals: any[] }[] = []
    let id: string | null = null
    const b: any = {
      select: () => b, order: () => b, limit: () => b, gte: () => b, not: () => b, is: () => b, maybeSingle: () => b,
      in: (col: string, vals: any[]) => { filters.push({ col, vals }); return b },
      eq: (col: string, v: any) => { if (col === 'id') id = v; return b },
      update: (v: any) => { op = 'update'; values = v; return b },
      insert: (v: any) => { op = 'insert'; values = v; return b },
      then: (res: any, rej?: any) => {
        let out: any = { data: null, error: null }
        if (table === 'trial_claims') {
          if (opts.claimsError) out = { data: null, error: { message: 'relation "trial_claims" does not exist' } }
          else if (op === 'insert') { claims.push({ ...values, created_at: values.created_at ?? NOW.toISOString() }); out = { data: null, error: null } }
          else out = { data: claims.filter(c => filters.every(f => f.vals.includes(c[f.col]))), error: null }
        } else if (table === 'entities' && op === 'update') {
          if (opts.noTrialStatus && 'trial_status' in values) out = { data: null, error: { message: 'column "trial_status" does not exist' } }
          else { entities[id!] = { ...(entities[id!] || {}), ...values }; out = { data: [], error: null } }
        }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return b
  }
  return { admin: { from }, claims, entities }
}

async function main() {
  process.env.CRON_SECRET = 'cron-secret-de-test-0123456789'
  delete process.env.TRIAL_HASH_SECRET
  const server = await import('../../lib/saas/trial-claim-server')

  console.log('1. Numéro')
  check('Cameroun : « 690 12 34 56 » → +237690123456', normalizePhone('690 12 34 56', 'CM') === '+237690123456', normalizePhone('690 12 34 56', 'CM'))
  check('format international accepté (+234 803 123 4567)', normalizePhone('+234 803 123 4567', 'CM') === '+2348031234567')
  check('Côte d\'Ivoire 10 chiffres : 07 07 12 34 56 → +2250707123456', normalizePhone('07 07 12 34 56', 'CI') === '+2250707123456', normalizePhone('07 07 12 34 56', 'CI'))
  check('numéro trop court, lettres, vide : refusés', normalizePhone('12345', 'CM') === null && normalizePhone('abc', 'CM') === null && normalizePhone('', 'CM') === null && normalizePhone(null, 'CM') === null)
  check('même numéro écrit autrement = même valeur (espaces, tirets, indicatif)', normalizePhone('6-90-12-34-56', 'CM') === normalizePhone('+237 690123456', 'CM'))

  console.log('\n2. Décision')
  const g = (entity: string | null, d: number, granted = true) => ({ entity_id: entity, granted, created_at: iso(d) })
  check('numéro jamais vu : essai accordé, rien à signaler', JSON.stringify(decideTrial({ phone: [], device: [], nameCity: [] }, 'e1', NOW)) === JSON.stringify({ granted: true, flags: [], previousAt: null }))
  const reused = decideTrial({ phone: [g('e0', -100)], device: [], nameCity: [] }, 'e1', NOW)
  check('numéro avec essai il y a 100 jours (autre entreprise) : REFUSÉ', !reused.granted && reused.flags.includes('phone_reused') && reused.previousAt === iso(-100))
  check('compte supprimé (entreprise détachée) : toujours refusé', !decideTrial({ phone: [g(null, -10)], device: [], nameCity: [] }, 'e1', NOW).granted)
  check('essai il y a plus de 12 mois : accordé de nouveau', decideTrial({ phone: [g('e0', -CLAIM_WINDOW_DAYS - 1)], device: [], nameCity: [] }, 'e1', NOW).granted)
  check('ligne refusée précédente (pas d\'essai) : ne compte pas', decideTrial({ phone: [g('e0', -5, false)], device: [], nameCity: [] }, 'e1', NOW).granted)
  check('même entreprise (renvoi du numéro) : ne compte pas', decideTrial({ phone: [g('e1', -1)], device: [], nameCity: [] }, 'e1', NOW).granted)
  const flagged = decideTrial({ phone: [], device: [g('e0', -3)], nameCity: [g('e9', -20)] }, 'e1', NOW)
  check('même appareil + même nom et ville : SIGNALÉ mais accordé', flagged.granted && flagged.flags.join() === 'same_device,same_name_city')
  check('nom + ville : accents, casse et ponctuation ignorés', nameCityKey('Amadou  Bello', 'Douala') === nameCityKey('amadou bello', 'DOUALA') && nameCityKey('Élodie', 'Yaoundé') === 'elodie|yaounde')
  check('nom ou ville absent : pas de clé (Google : ville vide)', nameCityKey('Amadou', '') === null && nameCityKey('', 'Douala') === null)
  check('identifiant d\'appareil : jeton accepté, valeur bizarre ignorée', cleanDeviceId('a'.repeat(32)) === 'a'.repeat(32) && cleanDeviceId('<script>') === null && cleanDeviceId(42) === null)
  check('essai : 30 jours', TRIAL_DAYS === 30 && trialEnd(NOW) === iso(30))
  check('fenêtre de 12 mois appliquée aux trois signaux', recentOthers([g('e0', -366)], 'e1', NOW).length === 0 && recentOthers([g('e0', -364)], 'e1', NOW).length === 1)

  console.log('\n3. Empreintes')
  const h = server.hashesOf('+237690123456')
  check('empreinte hexadécimale de 64 caractères, jamais le numéro', h.length === 1 && /^[0-9a-f]{64}$/.test(h[0]) && !h[0].includes('690123456'))
  check('stable : même numéro, même empreinte', server.hashesOf('+237690123456')[0] === h[0] && server.hashesOf('+237690123457')[0] !== h[0])
  process.env.TRIAL_HASH_SECRET = 'cle-dediee-essai-0123456789abcdef'
  const h2 = server.hashesOf('+237690123456')
  check('clé dédiée ajoutée : 2 empreintes, la nouvelle en premier, l\'ancienne toujours cherchée', h2.length === 2 && h2[1] === h[0] && h2[0] !== h[0])
  process.env.TRIAL_HASH_SECRET = 'courte'
  check('clé trop courte ignorée', server.hashesOf('x').length === 1)
  delete process.env.TRIAL_HASH_SECRET

  console.log('\n4. Enregistrement (base factice)')
  {
    const f = fakeAdmin()
    const r1 = await server.claimTrial(f.admin, { entityId: 'e1', ownerId: 'u1', phone: '+237690123456', deviceId: 'd'.repeat(32), name: 'Amadou Bello', city: 'Douala', country: 'CM', source: 'register' }, NOW)
    check('1re inscription : essai accordé, 30 jours, état « accordé »', r1.granted && r1.registered && f.entities.e1.trial_ends_at === iso(30) && f.entities.e1.trial_status === 'granted' && f.entities.e1.plan === 'trial')
    check('registre : empreintes seulement (numéro, appareil, nom + ville)', f.claims.length === 1 && /^[0-9a-f]{64}$/.test(f.claims[0].phone_hash) && /^[0-9a-f]{64}$/.test(f.claims[0].device_hash) && /^[0-9a-f]{64}$/.test(f.claims[0].name_hash) && !JSON.stringify(f.claims).includes('690123456'))
    const r2 = await server.claimTrial(f.admin, { entityId: 'e2', ownerId: 'u2', phone: '+237690123456', deviceId: null, name: 'Autre', city: 'Kribi', country: 'CM', source: 'register' }, NOW)
    check('même numéro, autre e-mail : compte SANS essai, état « refusé », fin datée de la veille (aucune journée offerte)', !r2.granted && f.entities.e2.trial_status === 'refused' && f.entities.e2.trial_ends_at === iso(-1))
    check('… refus inscrit au registre (accordé = non)', f.claims.length === 2 && f.claims[1].granted === false && f.claims[1].flags.includes('phone_reused'))
    const r3 = await server.claimTrial(f.admin, { entityId: 'e3', ownerId: 'u3', phone: '+237677000000', deviceId: 'd'.repeat(32), name: 'Amadou Bello', city: 'Douala', country: 'CM', source: 'oauth' }, NOW)
    check('autre numéro, même appareil et même nom + ville : accordé ET signalé', r3.granted && r3.flags.join() === 'same_device,same_name_city')
  }
  {
    const f = fakeAdmin([], { claimsError: true })
    const r = await server.claimTrial(f.admin, { entityId: 'e1', ownerId: 'u1', phone: '+237690123456', deviceId: null, name: null, city: null, country: 'CM', source: 'register' }, NOW)
    check('registre indisponible (213 absente) : essai accordé comme avant, jamais d\'inscription bloquée', r.granted && !r.registered && f.entities.e1.trial_ends_at === iso(30))
  }
  {
    const f = fakeAdmin([], { noTrialStatus: true })
    await server.setTrialState(f.admin, 'e1', { trial_ends_at: null, trial_status: 'pending_phone' })
    check('colonne d\'état absente : attente du téléphone → essai normal (pas de compte bloqué)', f.entities.e1.trial_ends_at !== null && !('trial_status' in f.entities.e1))
  }
  {
    const f = fakeAdmin()
    const r = await server.grantTrialByAdmin(f.admin, 'e2', 'admin1', 'Numéro partagé en famille', NOW)
    check('essai accordé à la main : 30 jours, état « accordé », ligne « admin » avec motif', r.ok && f.entities.e2.trial_status === 'granted' && f.entities.e2.trial_ends_at === iso(30) && f.claims[0].source === 'admin' && f.claims[0].reason === 'Numéro partagé en famille')
  }

  {
    const { getTrialDaysLeft, isAccessAllowed } = await import('../../lib/saas/plans')
    const veille = new Date(Date.now() - DAY).toISOString()
    check('essai refusé : accès FERMÉ tout de suite (fin datée de la veille)', !isAccessAllowed('trial', veille, null) && getTrialDaysLeft(veille) < 0)
  }

  console.log('\n5. Branchements (sources)')
  const reg = src('app/api/register/route.ts')
  check('inscription : numéro OBLIGATOIRE et contrôlé avant la création du compte', reg.includes('phone: z.string().min(4)') && reg.indexOf('normalizePhone(') < reg.indexOf('auth.admin.createUser'))
  check('inscription : essai décidé par le registre (plus d\'essai direct)', reg.includes('claimTrial(') && !reg.includes('setAccountPlan('))
  check('inscription : numéro enregistré au format international (boutique + profil)', reg.includes('whatsapp: phone,') && /country: countryConfig\.code,\s*\n?\s*phone,/.test(reg.replace(/\r/g, '')))
  const role = src('app/api/auth/set-role/route.ts')
  check('Google / Apple : essai EN ATTENTE du téléphone', role.includes("trial_status: 'pending_phone'") && !role.includes('setAccountPlan('))
  const ph = src('app/api/trial/phone/route.ts')
  check('écran du numéro : propriétaire seul, une seule fois, même règle', ph.includes('account.ownerId !== user.id') && ph.includes("trial_status !== 'pending_phone'") && ph.includes('claimTrial('))
  const layout = src('components/layout/app-layout.tsx')
  check('application : écran du numéro pour le propriétaire ; sinon mur « essai refusé » expliqué', layout.includes("trial_status === 'pending_phone'") && layout.includes('<TrialPhoneGate') && layout.includes("trialRefused={shop?.trial_status === 'refused'}"))
  const page = src('app/[locale]/(auth)/register/page.tsx')
  check('formulaire : champ international, numéro obligatoire, identifiant d\'appareil gardé', page.includes('<PhoneInput id="register-phone"') && page.includes("t(phone ? 'phone_invalid' : 'phone_required')") && page.includes('localStorage.setItem(DEVICE_ID_KEY, deviceId)'))
  const review = src('app/api/admin/trial-review/route.ts')
  check('admin : essai accordé à la main par super_admin, motif, journal', review.includes("tier: 'super_admin'") && review.includes('reason.length < 3') && review.includes("'admin.trial_grant'"))
  const cron = src('app/api/cron/grant-reminders/route.ts')
  check('tâche du matin : numéros des comptes d\'avant versés au registre', cron.includes('backfillTrialClaims(admin, normalizePhone)'))
  const mig = src('supabase/migrations/213_trial_claims.sql')
  check('213 : registre jamais vidé (entreprise détachée), aucun accès des comptes', mig.includes('ON DELETE SET NULL') && mig.includes('REVOKE ALL ON public.trial_claims FROM PUBLIC, anon, authenticated'))

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
}
main()
