// Règles pures de la réception des transferts (1er nov. 2026) : npx tsx tests/e2e/transfers-receive-pure.ts
import { ownSendBlocked, senderOf } from '../../lib/api/transfers'
import { receiveMode } from '../../lib/stock/transfers-view'
import { normalizeLocation, compareByLocation } from '../../lib/products/location'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }

const A = 'a', B = 'b', U = 'user', V = 'autre'
const tr = { status: 'sent', can_receive: true, source_shop_id: A, destination_shop_id: B }
check('arrivée choisie : « Réceptionner »', receiveMode(tr, B) === 'receive')
check('départ choisi : rien (ni réception, ni « Passer sur »)', receiveMode(tr, A) === 'none')
check('« Toutes » : « Passer sur … »', receiveMode(tr, null) === 'switch')
check('sans droit de réception : rien, même dans l’arrivée', receiveMode({ ...tr, can_receive: false }, B) === 'none')
check('déjà reçu : rien', receiveMode({ ...tr, status: 'received' }, B) === 'none')

check('expéditeur = sent_by, sinon created_by', senderOf({ sent_by: U, created_by: V }) === U && senderOf({ sent_by: null, created_by: V }) === V)
check('caissier qui a envoyé : réception refusée', ownSendBlocked({ sent_by: U }, U, 'cashier') === true)
check('responsable de boutique qui a envoyé : refusée', ownSendBlocked({ sent_by: U }, U, 'shop_manager') === true)
check('magasinier qui a envoyé : refusée', ownSendBlocked({ sent_by: U }, U, 'stock_manager') === true)
check('propriétaire qui a envoyé : permise (signalée dans l’historique)', ownSendBlocked({ sent_by: U }, U, 'owner') === false)
check('gérant qui a envoyé : permise', ownSendBlocked({ sent_by: U }, U, 'manager') === false)
check('caissier qui n’a pas envoyé : permise', ownSendBlocked({ sent_by: V }, U, 'cashier') === false)
check('ancien transfert sans sent_by : created_by fait foi', ownSendBlocked({ sent_by: null, created_by: U }, U, 'cashier') === true)

// Étape 10 : emplacement
check('emplacement : espaces resserrés', normalizeLocation('  Rayon 3 ,   étagère B ') === 'Rayon 3 , étagère B')
check('emplacement vide → aucun', normalizeLocation('   ') === null && normalizeLocation(null) === null)
check('61 caractères → refusé', normalizeLocation('x'.repeat(61)) === undefined && normalizeLocation('x'.repeat(60)) === 'x'.repeat(60))
const order = [{ name: 'Z', location: null }, { name: 'B', location: 'Rayon 10' }, { name: 'A', location: 'Rayon 2' }, { name: 'C', location: 'réserve' }, { name: 'D', location: 'Rayon 2' }]
  .sort(compareByLocation).map(x => x.name).join('')
check('ordre de tournée : Rayon 2 (A, D), Rayon 10, Réserve, sans emplacement à la fin', order === 'ADBCZ', order)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
