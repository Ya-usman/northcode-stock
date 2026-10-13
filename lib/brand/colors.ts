// Couleurs de marque StockShop utilisables hors des classes Tailwind (graphiques, styles calculés).
// Source unique : tailwind.config.ts lit ces valeurs pour ses jetons `stockshop-*`.
//
// Règle : #E3A80B est le SEUL jaune d'accent de marque. Les couleurs d'alerte
// (stock bas, avertissements) restent sémantiques et indépendantes ; les
// catégories ont leur propre palette, sans jaune ni orange proche de celui-ci.
export const STOCKSHOP_YELLOW = '#E3A80B'
