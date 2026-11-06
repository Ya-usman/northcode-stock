// Contenu du compte vitrine « Marché Soleil » — données entièrement fictives.
const D0 = '2026-10-12'            // dernier jour rempli (jour de création)
const DAYS = 30                    // 13 sept. → 12 oct.
const TZ_OFFSET_H = 1              // Cameroun = UTC+1

const SHOPS = [
  { key: 'akwa', name: 'Marché Soleil Akwa', city: 'Douala', daily: 12 },
  { key: 'bonapriso', name: 'Marché Soleil Bonapriso', city: 'Douala', daily: 7 },
  { key: 'bastos', name: 'Marché Soleil Bastos', city: 'Yaoundé', daily: 4 },
]
const OWNER_NAME = 'Aïcha Ndiaye'
const MEMBERS = [
  { key: 'jeanpaul', full_name: 'Jean-Paul Mbarga', role: 'shop_manager', shop: 'akwa', alias: 'jeanpaul' },
  { key: 'fatou', full_name: 'Fatou Bello', role: 'cashier', shop: 'akwa', alias: 'fatou' },
  { key: 'samuel', full_name: 'Samuel Etoa', role: 'cashier', shop: 'bonapriso', alias: 'samuel' },
  { key: 'mariam', full_name: 'Mariam Sow', role: 'stock_manager', shop: 'bastos', alias: 'mariam' },
]
// Qui vend, par boutique (poids)
const CASHIERS = { akwa: [['fatou', 65], ['jeanpaul', 25], ['owner', 10]], bonapriso: [['samuel', 85], ['owner', 15]], bastos: [['owner', 100]] }

const CATEGORIES = [
  ['alim', 'Alimentation', '#f59e0b'], ['boissons', 'Boissons', '#3b82f6'], ['frais', 'Fruits & légumes', '#10b981'],
  ['maison', 'Hygiène & maison', '#8b5cf6'], ['papeterie', 'Papeterie', '#ef4444'],
]
// [clé photo, nom, catégorie, unité, prix de vente, prix d'achat, popularité, code-barres ?]
const P = [
  ['riz', 'Riz parfumé 5 kg', 'alim', 'bag', 4500, 3800, 8, 1],
  ['sucre', 'Sucre en morceaux 1 kg', 'alim', 'box', 900, 750, 7, 1],
  ['farine', 'Farine de blé 1 kg', 'alim', 'bag', 700, 550, 5, 1],
  ['pates', 'Spaghetti 500 g', 'alim', 'pack', 500, 400, 8, 1],
  ['sel', 'Sel de cuisine 1 kg', 'alim', 'bag', 300, 200, 4, 1],
  ['arachides', 'Arachides 500 g', 'alim', 'bag', 800, 600, 5, 0],
  ['huile', 'Huile végétale 1 L', 'alim', 'bottle', 1500, 1250, 8, 1],
  ['miel', 'Miel pur 500 g', 'alim', 'piece', 3500, 2800, 2, 1],
  ['pain', 'Pain de campagne', 'alim', 'piece', 500, 350, 9, 0],
  ['chocolat', 'Tablette de chocolat noir', 'alim', 'piece', 1200, 900, 4, 1],
  ['lait', 'Lait frais 1 L', 'alim', 'bottle', 900, 700, 6, 1],
  ['oeufs', 'Œufs (plateau de 30)', 'alim', 'pack', 2400, 2000, 6, 0],
  ['eau', 'Eau minérale 1,5 L', 'boissons', 'bottle', 400, 300, 10, 1],
  ['jus', "Jus d'orange 1 L", 'boissons', 'bottle', 1000, 750, 6, 1],
  ['cafe', 'Café en grains 250 g', 'boissons', 'bag', 2500, 1900, 3, 1],
  ['the', 'Thé noir (25 sachets)', 'boissons', 'box', 800, 600, 4, 1],
  ['tomates', 'Tomates 1 kg', 'frais', 'kg', 800, 550, 8, 0],
  ['bananes', 'Bananes 1 kg', 'frais', 'kg', 600, 400, 8, 0],
  ['oranges', 'Oranges 1 kg', 'frais', 'kg', 700, 500, 6, 0],
  ['oignons', 'Oignons 1 kg', 'frais', 'kg', 700, 500, 7, 0],
  ['ananas', 'Ananas', 'frais', 'piece', 700, 450, 5, 0],
  ['avocats', 'Avocats (lot de 3)', 'frais', 'pack', 500, 300, 5, 0],
  ['piments', 'Piments 250 g', 'frais', 'pack', 300, 200, 4, 0],
  ['mangues', 'Mangues 1 kg', 'frais', 'kg', 900, 600, 4, 0],
  ['citrons', 'Citrons 500 g', 'frais', 'pack', 400, 250, 4, 0],
  ['carottes', 'Carottes 1 kg', 'frais', 'kg', 600, 400, 5, 0],
  ['pommes-de-terre', 'Pommes de terre 1 kg', 'frais', 'kg', 600, 450, 6, 0],
  ['ail', 'Ail 250 g', 'frais', 'pack', 500, 350, 3, 0],
  ['haricots', 'Haricots verts 500 g', 'frais', 'pack', 700, 500, 3, 0],
  ['savon', 'Savon de ménage', 'maison', 'piece', 450, 350, 7, 1],
  ['brosse-dents', 'Brosses à dents (lot de 2)', 'maison', 'pack', 1000, 700, 3, 1],
  ['serviettes', 'Serviette de toilette', 'maison', 'piece', 3000, 2200, 2, 0],
  ['bougies', 'Bougie parfumée', 'maison', 'piece', 1500, 1000, 2, 1],
  ['ampoule', 'Ampoule 60 W', 'maison', 'piece', 800, 550, 3, 1],
  ['balai', 'Balai en paille', 'maison', 'piece', 1500, 1000, 2, 0],
  ['cahier', 'Cahier 200 pages', 'papeterie', 'piece', 600, 450, 5, 1],
  ['stylo', 'Stylo à bille noir', 'papeterie', 'piece', 150, 100, 6, 1],
  ['crayons-couleur', 'Crayons de couleur (boîte de 12)', 'papeterie', 'box', 1200, 900, 3, 1],
]
const PRODUCTS = P.map(([key, name, cat, unit, sell, buy, weight, coded], i) => ({ key, name, cat, unit, sell, buy, weight, coded: !!coded, idx: i + 1 }))
const NOT_IN = {
  akwa: [],
  bonapriso: ['serviettes', 'bougies', 'balai', 'miel', 'cafe', 'crayons-couleur', 'haricots', 'ail', 'mangues', 'citrons', 'brosse-dents', 'chocolat'],
  bastos: PRODUCTS.map(p => p.key).filter(k => !['riz', 'sucre', 'pates', 'huile', 'pain', 'lait', 'oeufs', 'eau', 'jus', 'the', 'tomates', 'bananes', 'oranges', 'oignons', 'ananas', 'avocats', 'savon', 'cahier'].includes(k)),
}
const FAVORITES = ['eau', 'pain', 'riz', 'huile']
// Stock restant voulu après les ventes (les autres : confortable)
const REMAINDER = {
  akwa: { sucre: 4, stylo: 5, piments: 2, ampoule: 3, mangues: 0 },
  bonapriso: { farine: 6, the: 3 },
  bastos: { oeufs: 2 },
}

// Code-barres EAN-13 dans la plage réservée à l'usage interne des magasins (préfixe 2) : aucune collision avec un vrai produit
function ean13(idx) {
  const base = '200000000' + String(idx).padStart(3, '0')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
  return base + String((10 - (sum % 10)) % 10)
}

const SUPPLIERS = {
  akwa: [
    { key: 'littoral', name: 'Grossiste du Littoral', phone: '+237600000201', city: 'Douala' },
    { key: 'ferme', name: 'Ferme des Hauts Plateaux', phone: '+237600000202', city: 'Bafoussam' },
    { key: 'wouri', name: 'Boissons du Wouri', phone: '+237600000203', city: 'Douala' },
    { key: 'papeterie', name: 'Papeterie Centrale', phone: '+237600000204', city: 'Douala' },
  ],
  bonapriso: [
    { key: 'littoral', name: 'Grossiste du Littoral', phone: '+237600000201', city: 'Douala' },
    { key: 'ferme', name: 'Ferme des Hauts Plateaux', phone: '+237600000202', city: 'Bafoussam' },
  ],
  bastos: [{ key: 'mfoundi', name: 'Marché de gros du Mfoundi', phone: '+237600000205', city: 'Yaoundé' }],
}
const SUPPLIER_OF = { alim: 'littoral', boissons: 'wouri', frais: 'ferme', maison: 'littoral', papeterie: 'papeterie' }

const CUSTOMERS = {
  akwa: [
    { key: 'baobab', name: 'Restaurant Le Baobab', phone: '+237600000101', city: 'Douala', credit: true },
    { key: 'emmanuel', name: 'Emmanuel Tchoua', phone: '+237600000102', city: 'Douala', credit: true },
    { key: 'solange', name: 'Solange Ekotto', phone: '+237600000103', city: 'Douala', credit: true },
    { key: 'brigitte', name: 'Brigitte Fouda', phone: '+237600000104', city: 'Douala' },
    { key: 'clarisse', name: 'Clarisse Ngo Bassa', phone: '+237600000105', city: 'Douala' },
    { key: 'ibrahim', name: 'Ibrahim Oumarou', phone: '+237600000106', city: 'Douala' },
    { key: 'patrick', name: 'Patrick Nana', phone: '+237600000107', city: 'Douala' },
    { key: 'helene', name: 'Hélène Mvondo', phone: '+237600000108', city: 'Douala' },
  ],
  bonapriso: [
    { key: 'palmiers', name: 'Hôtel Les Palmiers', phone: '+237600000111', city: 'Douala', credit: true },
    { key: 'didier', name: 'Didier Kamdem', phone: '+237600000112', city: 'Douala' },
    { key: 'estelle', name: 'Estelle Manga', phone: '+237600000113', city: 'Douala' },
  ],
  bastos: [{ key: 'rachel', name: 'Rachel Abena', phone: '+237600000121', city: 'Yaoundé' }],
}

// Dépenses : [boutique, catégorie, libellé, montant, jours avant D0, moyen]
const EXPENSES = [
  ['akwa', 'salaries', 'Salaires de septembre', 180000, 12, 'bank_transfer'],
  ['akwa', 'rent', 'Loyer de la boutique — octobre', 150000, 11, 'bank_transfer'],
  ['akwa', 'internet', 'Abonnement internet', 15000, 10, 'mobile_money'],
  ['akwa', 'water', "Facture d'eau", 9500, 9, 'mobile_money'],
  ['akwa', 'electricity', "Facture d'électricité", 28500, 7, 'mobile_money'],
  ['akwa', 'marketing', 'Affiches promotion de rentrée', 10000, 20, 'cash'],
  ['akwa', 'supplies', 'Rouleaux de caisse', 4500, 18, 'cash'],
  ['akwa', 'transport', 'Taxi approvisionnement', 3500, 15, 'cash'],
  ['akwa', 'maintenance', 'Réparation du congélateur', 25000, 13, 'cash'],
  ['akwa', 'transport', 'Livraison fournisseur', 5000, 6, 'cash'],
  ['akwa', 'supplies', 'Sacs et emballages', 12000, 4, 'cash'],
  ['akwa', 'transport', 'Transport de marchandises', 8000, 2, 'cash'],
  ['akwa', 'other', 'Nettoyage du magasin', 6000, 1, 'cash'],
  ['akwa', 'transport', 'Transport de marchandises', 4000, 0, 'cash'],
  ['akwa', 'supplies', "Produits d'entretien", 3500, 0, 'cash'],
  ['bonapriso', 'rent', 'Loyer de la boutique — octobre', 120000, 11, 'bank_transfer'],
  ['bonapriso', 'electricity', "Facture d'électricité", 19000, 6, 'mobile_money'],
  ['bonapriso', 'transport', 'Transport de marchandises', 6000, 3, 'cash'],
  ['bastos', 'rent', 'Loyer de la boutique — octobre', 100000, 11, 'bank_transfer'],
  ['bastos', 'electricity', "Facture d'électricité", 14500, 5, 'mobile_money'],
]
const BUDGETS = { akwa: { rent: 150000, salaries: 200000, electricity: 30000, transport: 25000, supplies: 20000, marketing: 15000 } }

// Achats du jour (Akwa) : [fournisseur, état voulu, lignes [produit, quantité commandée, quantité reçue, péremption en jours]]
const PURCHASES = [
  { supplier: 'littoral', state: 'received', pay: 0.6, lines: [['riz', 40, 40, 300], ['huile', 36, 36, 200], ['pates', 60, 60, 400]] },
  { supplier: 'wouri', state: 'partial', pay: 0, lines: [['eau', 120, 120, 365], ['jus', 48, 36, 21], ['lait', 24, 24, 5]] },
  { supplier: 'ferme', state: 'sent', lines: [['oeufs', 20], ['tomates', 40], ['bananes', 50]] },
  { supplier: 'papeterie', state: 'draft', lines: [['cahier', 100], ['stylo', 200]] },
]
// Réassorts avec date de péremption (Akwa) : [produit, quantité, péremption en jours]
const RESTOCKS = [['oeufs', 12, 9], ['pain', 20, 2], ['chocolat', 24, 120]]
// Transferts : Akwa → Bonapriso (reçu), Akwa → Bastos (en route)
const TRANSFERS = [
  { to: 'bonapriso', receive: true, lines: [['riz', 10], ['huile', 12]] },
  { to: 'bastos', receive: false, lines: [['eau', 24], ['savon', 10]] },
]
// Inventaire à Bastos : [produit, écart, motif]
const INVENTORY = [['pain', -2, 'expiry'], ['tomates', -3, 'loss'], ['oranges', 1, null]]
// Reprises de dette
const OPENINGS = [
  { shop: 'akwa', kind: 'customer', party: 'ibrahim', amount: 35000, debt_date: '2026-08-28', due_date: '2026-10-31', note: 'Solde de l\'ancien cahier' },
  { shop: 'akwa', kind: 'supplier', party: 'papeterie', amount: 85000, debt_date: '2026-09-05', note: 'Facture de rentrée restant due' },
]

const base = { D0, DAYS, TZ_OFFSET_H, SHOPS, OWNER_NAME, MEMBERS, CASHIERS, CATEGORIES, PRODUCTS, NOT_IN, FAVORITES, REMAINDER, ean13, SUPPLIERS, SUPPLIER_OF, CUSTOMERS, EXPENSES, BUDGETS, PURCHASES, RESTOCKS, TRANSFERS, INVENTORY, OPENINGS }

module.exports = base
