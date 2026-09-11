# Rapport de migration — Devises V3 (StockShop)

> **Statut : terminée.** Rollout progressif A → E livré le 2026-09-11.
> Dernier commit couvert : `4db27c9`.
> Ce document est le livrable final (§31 du cahier des charges V3). Il est
> figé : toute évolution ultérieure du système de devises fera l'objet
> d'une V4 (voir dernière section).
>
> **Convention de renvoi** : `§N` seul = section de ce rapport ;
> `cahier V3 §N` = section du cahier des charges V3 d'origine.

---

## 1. Résumé de la V3

`shops.currency` stockait historiquement un **symbole d'affichage**
(`« F CFA »`, `« ₦ »`). Deux problèmes :

1. **Ambiguïté** — `« F CFA »` recouvre deux devises distinctes et non
   interchangeables : **XOF** (BCEAO, Afrique de l'Ouest) et **XAF**
   (BEAC, Afrique centrale). Impossible de les distinguer dans la logique
   métier (reporting multi-devise, passerelles de paiement, parrainage).
2. **Instabilité** — une chaîne d'affichage (`« FCFA »` vs `« F CFA »`,
   `« ₦ »` vs `« NGN »`) n'est pas une clé fiable pour brancher des
   `if`/`switch`.

**La V3 fait du code ISO 4217 la clé métier** (`NGN`, `XOF`, `XAF`,
`GHS`, …). Le symbole ne sert plus qu'à l'affichage, via un formateur
central unique. Aucun montant n'a été modifié — seule la représentation
de la devise a évolué.

Contraintes respectées tout au long :

- audit d'impact **avant** toute migration de données ;
- **aucune** fonctionnalité cassée ;
- **aucun** remplacement global aveugle (`« F CFA » → XAF` pour tous) ;
- les anciennes données restent lisibles pendant et après la transition ;
- migration **réversible** (snapshot + rollback documenté) ;
- **jamais** de fusion XOF/XAF dans la logique métier.

---

## 2. État avant / après

| | Avant V3 | Après V3 |
|---|---|---|
| `shops.currency` (contenu) | symbole d'affichage (`« F CFA »`, `« ₦ »`) | **code ISO** (`XOF`, `XAF`, `NGN`, …) |
| `shops.currency` (défaut SQL) | `'₦'` (`001_schema`, 2020) | `'NGN'` |
| `shops.currency` (nullable) | oui | **`NOT NULL`** |
| `shops.currency` (contrainte) | aucune | **`CHECK` sur 14 codes ISO** (`shops_currency_supported`) |
| Désambiguïsation « F CFA » | impossible | par le pays de la boutique (`currency_code_for_country`) |
| Formatage des montants | concaténations dispersées (`amount + ' FCFA'`, `'₦' + amount`), heuristique `symbol.length > 2` | `formatCurrency(montant, codeISO)` central, métadonnées issues d'un registre unique |
| Revenu admin multi-devise | somme binaire **NGN vs « CFA »** (fusionne XOF+XAF, met GHS/EUR/USD dans « NGN ») | **ventilation par code ISO réel** (`formatMoneyByCurrency`) |
| Écritures de `shops.currency` | 6 chemins écrivant un symbole (parfois fourni par le client) | 6 chemins écrivant un **code ISO dérivé du pays**, validés |
| Edge functions Deno `daily-report` / `generate-receipt` | présentes (code mort, doublon des crons Next) | **supprimées** |

---

## 3. Formats de devise détectés (audit initial)

Valeurs réellement présentes dans `shops.currency` avant migration
(14 boutiques actives) :

| Valeur brute | Nb boutiques | Nature |
|---|---:|---|
| `F CFA` | 12 | symbole **ambigu** (XOF ou XAF) |
| `₦` | 2 | symbole non ambigu → NGN |

Variantes historiques tolérées par la couche de compatibilité (au cas où
elles apparaîtraient : anciens clients, imports) :

- **Franc CFA** : `F CFA`, `FCFA`, `CFA`, `FRS CFA`, `FR CFA`, `F.CFA`
- **Symboles non ambigus** : `₦`, `€`, `$`, `CA$` / `C$`, `GH₵`, `FG`,
  `D`, `Le`, `L$`, `Esc`, `UM`, `FC`

Aucune valeur inconnue ou inclassable détectée.

---

## 4. Mapping appliqué

### 4.1 Symboles non ambigus → code ISO (correspondance directe)

| Symbole | Code ISO |
|---|---|
| `₦` | `NGN` |
| `€` | `EUR` |
| `$` | `USD` |
| `CA$` / `C$` | `CAD` |
| `GH₵` | `GHS` |
| `FG` | `GNF` |
| `D` | `GMD` |
| `Le` | `SLE` |
| `L$` | `LRD` |
| `Esc` | `CVE` |
| `UM` | `MRU` |
| `FC` | `CDF` |

### 4.2 Franc CFA (ambigu) → départage par le pays

Fonction SQL `currency_code_for_country(p_country)` (créée en migration
137, `IMMUTABLE`) :

| Pays | Code |
|---|---|
| `CM`, `CG`, `GA`, `GQ`, `CF`, `TD` | **`XAF`** |
| `CI`, `ML`, `NE`, `SN`, `BJ`, `TG`, `BF`, `GW` | **`XOF`** |
| `NG`→`NGN`, `GH`→`GHS`, `GN`→`GNF`, `GM`→`GMD`, `SL`→`SLE`, `LR`→`LRD`, `CV`→`CVE`, `MR`→`MRU`, `CD`→`CDF`, `EU`→`EUR`, `US`→`USD`, `CA`→`CAD` | (autres) |
| _autre / inconnu_ | `NGN` (repli) |

**Règle de sécurité de la migration 141** : la conversion d'un symbole
CFA n'est appliquée **que si** `currency_code_for_country(pays)` renvoie
`XAF` **ou** `XOF`. Sinon la ligne est laissée telle quelle et
journalisée en anomalie — jamais d'invention.

### 4.3 Résultat des 14 boutiques

| `currency_legacy` | Pays | → Code ISO | Nb |
|---|---|---|---:|
| `F CFA` | CI | `XOF` | 4 |
| `F CFA` | NE | `XOF` | 3 |
| `F CFA` | TG | `XOF` | 1 |
| `F CFA` | CM | `XAF` | 4 |
| `₦` | NG | `NGN` | 2 |

Total : `F CFA` ×12 → XOF ×8 + XAF ×4 ; `₦` ×2 → NGN ×2.
Distribution finale : **XOF ×8, XAF ×4, NGN ×2**.

---

## 5. Boutiques migrées

**14 boutiques actives migrées, 0 supprimée concernée, 0 anomalie.**

Journal `currency_migration_log` : **14 lignes, toutes en statut
`migrated`** (0 `already_iso`, 0 `anomaly`).

| Boutique | Pays | Avant | Après |
|---|---|---|---|
| SOFAR WATCHES | CI | `F CFA` | `XOF` |
| Boutique de Isabelle Kossa | CI | `F CFA` | `XOF` |
| OGO DELIVERY | CI | `F CFA` | `XOF` |
| Boutique de Rebecca Yene | CI | `F CFA` | `XOF` |
| Boutique de Axel-elies NGuemto kossa | CM | `F CFA` | `XAF` |
| Boutique Alpha | CM | `F CFA` | `XAF` |
| Türkisch shop | CM | `F CFA` | `XAF` |
| Cindy business | CM | `F CFA` | `XAF` |
| SOFAR BONKANEY | NE | `F CFA` | `XOF` |
| SOFAR BONKANEY | NE | `F CFA` | `XOF` |
| Maoudé shop | NE | `F CFA` | `XOF` |
| PlombElectSARL | NG | `₦` | `NGN` |
| yahaya & zainab 2 | NG | `₦` | `NGN` |
| HD | TG | `F CFA` | `XOF` |

---

## 6. Anomalies

**Aucune.**

- 0 boutique avec un symbole CFA sans pays fiable.
- 0 boutique avec une valeur devise inconnue.
- 0 boutique dont le pays n'a pas permis de trancher XOF/XAF.
- 0 ligne `currency_migration_log` en statut `anomaly`.
- Filet de sécurité de la migration 142 (`UPDATE … WHERE currency IS NULL
  OR currency !~ '^[A-Z]{3}$'`) : **0 ligne touchée**.

Le mécanisme de détection d'anomalie reste en place : toute valeur
non résolue aurait été journalisée en `anomaly` avec une note
« à traiter manuellement », sans blocage de la migration.

---

## 7. Fonctions centrales

### 7.1 Registre — `lib/saas/currencies.ts`

Source de vérité unique. 14 devises, construites depuis `lib/saas/countries.ts`.

| Export | Rôle |
|---|---|
| `CURRENCIES` | `Record<code, CurrencyDef>` — `{ code, label, symbol, decimals, symbolPosition, numberLocale, countries[], active }` |
| `CURRENCY_LIST` | liste triée par libellé (sélecteurs admin) |
| `SUPPORTED_CURRENCY_CODES` | les 14 codes — **miroir de la contrainte SQL `shops_currency_supported`** |
| `isSupportedCurrencyCode(code)` | `code` ∈ les 14 ? |
| `normalizeCurrency(value, country?)` | **stricte** : symbole / variante CFA / code → code ISO, ou `null` (= anomalie à tracer/rejeter). Ne devine jamais depuis le seul pays. |
| `resolveCurrencyCode(value, country?)` | comme `normalizeCurrency` mais **jamais `null`** : repli pays puis `NGN`. **Affichage uniquement.** |
| `currencyCodeForCountry(country)` | code ISO par défaut d'un pays (`getCountry().currency` fait foi) |
| `displayMetaFor(value)` | métadonnées d'affichage `{ symbol, decimals, symbolPosition, numberLocale }` pour n'importe quelle entrée (code, symbole, variante, inconnu → heuristique) |
| `currencySymbol(codeOrSymbol)` | symbole d'affichage d'un code (passe-plat si déjà un symbole) |
| `isFrancCfaCurrency(value)` | `true` pour `XAF`/`XOF`/symboles CFA — remplace les `.includes('CFA')` dispersés |
| `getCurrency(code)` | `CurrencyDef` (repli `NGN`) |
| `REFERRAL_CURRENCIES` | `@deprecated` — compat module Parrainage V2 |

### 7.2 Formateur — `lib/utils/currency.ts`

| Export | Rôle |
|---|---|
| `formatCurrency(montant, currency, locale?)` | **SEUL point de formatage.** `currency` = code ISO (cible) ou symbole legacy (toléré). Métadonnées via `displayMetaFor`. |
| `formatMoneyByCurrency(byCode)` | **(Phase D)** ventile un `Record<code, montant>` — un segment par devise réelle, trié décroissant, joint par `« · »`. XOF et XAF gardent des segments distincts. |
| `chartTickFormatter(v, currency, omitSymbol, locale?)` | ticks d'axe (`1k`, `1.5M`, `1Md`) |
| `formatNairaCompact(montant, currency?)` | format compact `₦1.2M` / `45.0K F CFA` |
| `parseNaira(str)` | chaîne monétaire → nombre |
| `formatInputValue(digits, currency)` | champ prix (séparateurs, sans symbole) |
| `formatNaira(x)` | `@deprecated` → `formatCurrency(x, 'NGN')` |
| `currencySymbol` | ré-export de `currencies.ts` |

### 7.3 Hook — `lib/hooks/use-currency.ts`

```ts
const { fmt, code, symbol } = useCurrency()
//   fmt(1500) → "₦1,500" | "1 500 F CFA" | "1 500 €"
//   code      → "NGN" | "XAF" | "XOF"   (logique métier)
//   symbol    → "₦" | "F CFA"           (affichage brut)
```
`code = resolveCurrencyCode(shop?.currency, shop?.country)`.

### 7.4 SQL — `currency_code_for_country(p_country text)`

Migration 137, `IMMUTABLE`. Utilisée par la migration 141 et par le
moteur de parrainage (devise du portefeuille du parrain).

---

## 8. Migrations

### 8.1 `141_shops_currency_iso.sql` — Phase B (données)

**Non destructive.**

1. **Snapshot** : `ALTER TABLE shops ADD COLUMN IF NOT EXISTS
   currency_legacy text` ; `UPDATE … SET currency_legacy = currency`.
2. **Journal** : `CREATE TABLE currency_migration_log
   (shop_id, old_value, country, new_value, status, note, created_at)`,
   RLS activé (service-role uniquement). `status` ∈
   `migrated` | `already_iso` | `anomaly`.
3. **Symboles non ambigus → ISO** : 12 `UPDATE` ciblés (§4.1).
4. **Franc CFA → départage pays** : `UPDATE shops SET currency =
   currency_code_for_country(country) WHERE currency IN (variantes CFA)
   AND currency_code_for_country(country) IN ('XAF','XOF')`.
5. **Journalisation** : une ligne par boutique, idempotente
   (`NOT EXISTS`).

**Rollback** (une instruction) :
```sql
UPDATE shops SET currency = currency_legacy WHERE currency_legacy IS NOT NULL;
```

### 8.2 `142_shops_currency_constraint.sql` — Phase E (schéma)

**Non destructive.** Aucun changement de code applicatif.

1. **Filet de sécurité idempotent** : journalise puis force `NGN` toute
   valeur `NULL` ou non-ISO résiduelle (0 ligne à l'exécution).
2. `ALTER TABLE shops ALTER COLUMN currency SET DEFAULT 'NGN'` (corrige
   le `'₦'` de `001_schema`).
3. `ALTER TABLE shops ALTER COLUMN currency SET NOT NULL`.
4. `ALTER TABLE shops ADD CONSTRAINT shops_currency_supported CHECK
   (currency IN (14 codes ISO))` — miroir de `SUPPORTED_CURRENCY_CODES`.

**Rollback** (en en-tête du fichier) :
```sql
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
ALTER TABLE shops ALTER COLUMN currency DROP NOT NULL;
ALTER TABLE shops ALTER COLUMN currency SET DEFAULT '₦';
```

**Codes de violation observés** (test-v3-phaseE) : `23514`
(check_violation) pour `F CFA` / `FCFA` / `₦` / `ZZZ` / `ngn` / `xof` /
`''` ; `23502` (not_null_violation) pour `NULL`.

> Les tables `currency` du module Parrainage (5) et `exchange_rates`
> étaient déjà en code ISO (V2). La contrainte 142 ne concerne que
> `shops`.

---

## 9. Commits A → E

Tous datés du **2026-09-11**, branche `main`.

| Phase | Commit | Objet |
|---|---|---|
| **A** | `fac856e` | registre central + `normalizeCurrency` + formateur compatible **byte-identique** à l'ancien pour les symboles réels. Aucune migration de données. |
| **B** | `ae363dd` | migration 141 : `shops.currency` symbole → code ISO (14 boutiques). Corrections de manifestes révélées par la migration (bucketing admin `.includes('CFA')`, ISO brut affiché en POS/dépenses/toast, re-symbolisation au save des paramètres). |
| **C** | `5ff500c` | les 6 chemins d'écriture de `shops.currency` produisent un code ISO ; validation `normalizeCurrency` → `400` ; garde §10 (owner ne peut pas changer la devise si ventes/dépenses existent → `403`) ; `normalizeCurrency` rendue stricte. |
| **D** | `a812acf` | formatage centralisé partout ; `formatAdminRevenue` **supprimée** → `formatMoneyByCurrency` (ventilation par devise réelle) ; crons `evening-summary` (corrige les emails affichant `« 1 234 XAF »` brut) + `low-stock-alert` (param devise mort retiré) ; edge functions mortes supprimées ; nettoyage i18n ; `formatRefAmount` → `formatCurrency`. |
| **E** | `4db27c9` | migration 142 : `DEFAULT 'NGN'` + `NOT NULL` + `CHECK`. Verrouillage du schéma. |

---

## 10. Chemins d'écriture de `shops.currency` modifiés (Phase C)

| Fichier | Avant | Après |
|---|---|---|
| `app/api/register/route.ts` | `countryConfig.currencySymbol` | `countryConfig.currency` (ISO) |
| `app/api/auth/set-role/route.ts` | `countryConfig.currencySymbol` | `countryConfig.currency` (ISO) |
| `app/api/shops/route.ts` | `getCountry(c).currencySymbol` | `currencyCodeForCountry(country)` |
| `app/api/admin/owner/route.ts` | `currency \|\| '₦'` (valeur client) | `currencyCodeForCountry(country \|\| 'NG')` — la valeur client est **ignorée** |
| `app/api/shops/settings/route.ts` | passthrough client non validé | `normalizeCurrency(value, country)` → `400` si non reconnu ; si seul le pays change → re-dérivé du pays ; **garde (cahier V3 §10)** : changement de devise bloqué (`403`) pour un owner dont la boutique a des ventes/dépenses (le super_admin garde la main) |
| `app/api/admin/shop-action/route.ts` (`edit_shop`) | `updates.currency = currency` (brut) | `normalizeCurrency(currency, country)` → `400` si non reconnu ; sinon dérivé du pays quand le pays change |

UI associée : `components/admin/create-owner-modal.tsx` (n'envoie plus de
devise — dérivée serveur) ; `components/admin/shop-inspector.tsx` (champ
« Devise (code ISO) », majuscules forcées, placeholder `XAF, XOF, NGN,
EUR…`).

i18n (Phase D) : suppression des clés orphelines
`landing.pricing.toggle_ng` / `toggle_cm` ; `saas.feature_starter`
dé-prix (« …à partir de ₦4 500/mois » → texte générique) — fr/en/ha.

---

## 11. Impact par domaine

| Domaine | Impact | État |
|---|---|---|
| **POS / Caisse** | `caisse/page.tsx` et `sales/new/page.tsx` via `useCurrency()` → `resolveCurrencyCode` + `formatCurrency`. Plus de `{shop?.currency \|\| '₦'}` en préfixe brut. | ✅ testé (render 200, pas de code ISO brut affiché) |
| **Abonnements / Facturation** | `subscriptions` n'a pas de colonne `currency` — la devise est celle de la boutique. Pages admin (`/admin`, `/admin/analytics`, `/admin/payments`) : revenu **ventilé par code ISO réel** via `formatMoneyByCurrency`, plus de somme binaire NGN/CFA. `revenueGrowth` (%) garde une somme brute inter-devises — signal directionnel, jamais affiché comme total, documenté dans le code. | ✅ testé |
| **Parrainage** | Déjà en code ISO depuis la V2 (commit `3f90332`, migrations 136-137). `formatRefAmount` (notifications) passé au formateur central en Phase D : `« 2 000 ₦ » → « ₦2,000 »` (affichage uniquement). `min_payout_by_currency` indexé par code ISO. KPI admin déjà ventilés par devise (commit `574181a`). | ✅ non-régression (test-phase7-notify 32/32, test-config-admin 37/37) |
| **Offline / Sync** | `lib/offline/` **ne persiste aucune devise** — les ventes/produits hors-ligne n'embarquent pas de `currency`. La devise est résolue à l'affichage depuis `shop.currency` (contexte auth). Aucun impact. | ✅ pas de changement nécessaire |
| **Exports CSV** | `app/api/admin/export/{shops,payments}/route.ts` écrivent `shop.currency` brut (désormais un code ISO — identifiant stable, adapté à un export). Repli `\|\| '₦'` résiduel (dette mineure, §13). | ✅ fonctionne |
| **Reçus PDF** | `lib/utils/pdf.ts` dérive la devise de `getCountry(shop.country).currency` — **ne lit pas `shop.currency`**. V3-safe par construction. Utilise encore son propre `isNGN` + `countryConfig.currencySymbol` plutôt que `formatCurrency` (dette mineure, §13). | ✅ fonctionne |
| **Emails cron** | `evening-summary` (bilan quotidien) : corrigé en Phase D — affichait `« 1 234 XAF »` (code brut) depuis la migration 141, affiche désormais `« 1 234 F CFA »` via `formatCurrency`. `low-stock-alert` : ne formate aucun montant, param devise retiré. | ✅ corrigé |
| **Reporting multi-devise (V2.2)** | `exchange_rates` en code ISO ; conversions via `open.er-api.com`. Aucune conversion appliquée aux montants réels — seulement à l'affichage agrégé. | ✅ non-régression (test-fx 34/34) |

---

## 12. Tests exécutés et résultats

Scripts dans le répertoire de travail de session (`.ts` exécutés via
`npx tsx` depuis `coverage/`, gitignoré ; `.js` depuis la racine).

### Suite V3 dédiée

| Test | Assertions | Couverture |
|---|---:|---|
| `test-v3-phaseA` | **46 / 46** | `normalizeCurrency` (strict), `resolveCurrencyCode`, `formatCurrency` byte-identique à l'ancien sur `₦`/`F CFA`/`$`/`CA$`/`GH₵` (40 cas, 0 différence), registre, 14 boutiques normalisent sans anomalie |
| `test-v3-phaseB` | **11 / 11** | migration 141 appliquée, `currency_legacy` conservé, split NGN/CFA correct post-ISO, rendu POS/settings/admin, rollback simulé |
| `test-v3-phaseC` | **10 / 10** | écritures ISO dérivées du pays, `admin/owner` ignore la valeur client, `shops/settings` rejette `NOTACURRENCY` (`400`), garde §10 (`403` avec historique), super_admin normalise `« F CFA »`+pays |
| `test-v3-phaseD` | **29 / 29** | `formatMoneyByCurrency` (XOF/XAF segments distincts, tri, replis), `formatRefAmount` centralisé, landing sans code brut, pages admin sans code ISO brut, crons centralisés, nettoyage vérifié |
| `test-v3-phaseE` | **22 / 22** | `CHECK` rejette `F CFA`/`FCFA`/`₦`/`ZZZ`/`ngn`/`xof`/`''` (`23514`) + `NULL` (`23502`), ligne inchangée après rejet, code ISO valide accepté, INSERT sans devise → `NGN`, `currency_legacy`/journal intacts, smoke app |

### Non-régression

| Test | Résultat |
|---|---|
| `test-fx` (reporting multi-devise) | **34 / 34** |
| `test-multicurrency-kpi` | **15 / 15** |
| `test-config-admin` (éditeur config parrainage) | **37 / 37** |
| `test-ui-smoke` | **13 / 13** |
| `test-phase8` (anti-fraude parrainage) | **18 / 18** |
| `test-phase7-notify` (notifications parrainage) | **32 / 32** |
| `test-late-association` | **10 / 10** |
| `render-v3` (rendu 6 pages boutique) | **6 / 6** — HTTP 200 |

> Note : `test-config-admin` (section E) et `test-phase7-notify` sautent
> quelques sous-tests si un portefeuille de parrainage résiduel existe
> d'un run précédent — état inter-runs, **pas une régression** ; relancer
> isolément pour le compte plein.

### Build

`npx tsc --noEmit -p .` : propre — `rm -rf .next && npm run build` :
`Compiled successfully`. À chaque phase.

---

## 13. Dette technique restante

Choix **assumé** du périmètre conservateur (validé avec l'utilisateur) —
ces éléments ne sont **pas des oublis**.

| Élément | Pourquoi conservé | Retrait conditionné à |
|---|---|---|
| `shops.currency_legacy` (colonne) | voie de retour de la migration 141 (cahier V3 §27) | §14 |
| `currency_migration_log` (table) | traçabilité + rollback 141 | §14 |
| Tolérance symboles dans `normalizeCurrency` / `displayMetaFor` / `formatCurrency` | défense en profondeur à coût nul ; garantit le rendu de toute donnée figée d'avant la 141 (§15) | §14 |
| `app/api/admin/export/{shops,payments}/route.ts` — repli `\|\| '₦'` | mort (colonne `NOT NULL`) mais inoffensif ; devrait être `'NGN'` | nettoyage cosmétique libre |
| `lib/utils/pdf.ts` — `isNGN` + `countryConfig.currencySymbol` maison | fonctionnellement correct (dérive du pays) ; n'utilise pas `formatCurrency` | nettoyage cosmétique libre |
| `formatNaira`, `formatNairaCompact`, `REFERRAL_CURRENCIES` — `@deprecated` | encore appelés par du code hérité | remplacement progressif des appelants |
| `currency_code_for_country` (SQL) vs `getCountry().currency` (TS) | la fonction SQL a une liste de pays codée en dur ; le TS fait foi. Divergence possible pour un pays hors liste (→ `NGN` côté SQL). | aligner si un nouveau pays CFA est ajouté |

---

## 14. Vérifications avant suppression des mécanismes legacy

Checklist à valider **avant** de créer une future migration qui
supprimerait `currency_legacy`, `currency_migration_log` et/ou la
tolérance aux anciens symboles. **Ne rien retirer tant que tous les
points ne sont pas cochés.**

### 14.1 Avant `DROP COLUMN shops.currency_legacy`

- [ ] La contrainte `shops_currency_supported` est en place depuis
      **≥ 3 mois en production** sans incident (aucun `23514` légitime
      dans les logs).
- [ ] `SELECT count(*) FROM currency_migration_log WHERE status =
      'anomaly'` = **0**.
- [ ] `SELECT count(*) FROM shops WHERE currency !~ '^[A-Z]{3}$' OR
      currency IS NULL` = **0** (y compris `deleted_at IS NOT NULL`).
- [ ] Aucune procédure d'exploitation ne référence `currency_legacy`
      (grep infra, runbooks, dashboards).
- [ ] Une sauvegarde de la table `shops` (ou un export
      `id, currency, currency_legacy`) est archivée hors-ligne — le
      rollback 141 ne sera plus possible après le `DROP`.
- [ ] Le test `test-v3-phaseB` section 4 (« rollback simulé ») est
      retiré ou adapté dans le même commit.

### 14.2 Avant `DROP TABLE currency_migration_log`

- [ ] Tous les points de 14.1 sont validés.
- [ ] Le contenu du journal a été exporté et archivé (valeur
      historique / audit).
- [ ] Aucune requête analytique / BI ne lit cette table.

### 14.3 Avant de retirer la tolérance aux symboles

_(dans `normalizeCurrency`, `displayMetaFor`, `formatCurrency` — c.-à-d.
faire échouer / renvoyer `null` sur une entrée qui n'est pas un code ISO)_

- [ ] **Reçus JSON stockés** : inventorier le bucket Storage `receipts`.
      Confirmer qu'aucun blob `*.json` ne contient un champ `currency`
      avec un symbole (`grep` sur un dump, ou script de scan).
      → Voir §15. Options : (a) migrer les blobs, (b) ré-générer les
      reçus à la demande, (c) garder `displayMetaFor` tolérant
      uniquement pour le rendu des reçus.
- [ ] **Aucun appelant** de `formatCurrency` / `displayMetaFor` ne peut
      recevoir autre chose qu'un code ISO. Vérifier :
      `shop.currency` (contraint ✓), `resolveCurrencyCode(...)` (✓),
      `country.currency` (✓), littéraux (✓), **snapshots hors-ligne**
      (aucune devise persistée ✓), **imports / API tierces**.
- [ ] `normalizeCurrency` : plus aucun chemin d'écriture ne dépend de la
      normalisation d'un symbole fourni par un client
      (`shops/settings`, `shop-action`). Les frontends envoient un code
      ISO depuis la Phase C — confirmer qu'aucun client mobile / ancienne
      version en circulation n'envoie encore un symbole.
- [ ] Période de dépréciation : logguer (sans donnée sensible, cahier V3 §26)
      chaque appel `normalizeCurrency` recevant un non-code pendant
      **≥ 1 mois**. Retrait seulement si le compteur reste à 0.
- [ ] Les tests `test-v3-phaseA` (assertions « symbole → code ») et le
      formateur byte-identique sont adaptés dans le même commit.

### 14.4 Ordre recommandé

1. Retirer la tolérance `normalizeCurrency` (écriture) — faible risque,
   les frontends sont déjà à jour.
2. Nettoyer les replis `|| '₦'` résiduels (exports, `pdf.ts`).
3. Traiter les reçus JSON stockés, puis restreindre `displayMetaFor` /
   `formatCurrency`.
4. `DROP COLUMN currency_legacy`.
5. `DROP TABLE currency_migration_log` (ou archivage).

---

## 15. Compatibilité maintenue pour les anciens reçus / données snapshot

### 15.1 Principe

`formatCurrency` et `displayMetaFor` **tolèrent délibérément les
symboles** en entrée, en plus des codes ISO :

- `displayMetaFor('F CFA')` → `{ symbol: 'F CFA', decimals: 0,
  symbolPosition: 'after', numberLocale: 'fr-FR' }` (via `CFA_SYMBOLS` ;
  résout sur XOF pour l'affichage — XOF et XAF ont le même rendu).
- `displayMetaFor('₦')` → métadonnées NGN.
- `displayMetaFor('<inconnu>')` → repli heuristique (symbole long =
  suffixe, `fr-FR` si contient `CFA`) — **comportement identique à
  l'ancien formateur**, propriété testée en Phase A (40 cas, 0
  différence).

Cette tolérance est conservée comme **défense en profondeur à coût nul** :
elle garantit qu'aucune donnée figée d'avant la migration 141 ne peut
casser un rendu, quel qu'en soit le chemin.

### 15.2 État réel des sources de symboles

Au moment de la rédaction, **aucun chemin de code vivant ne persiste ni
ne transmet un symbole de devise** :

- `shops.currency` : contraint ISO (migration 142).
- Snapshots hors-ligne (`lib/offline/`) : ne stockent aucune devise.
- Notifications de parrainage : le texte formaté est figé à l'écriture
  (`admin_notifications.message`), jamais re-formaté.
- Reçus PDF : générés côté client (`lib/utils/pdf.ts`) à partir de
  `getCountry(shop.country)`, non persistés.

### 15.3 Cas résiduel à vérifier : bucket Storage `receipts`

L'ancienne edge function `generate-receipt` (supprimée en Phase D)
**était conçue pour** écrire des blobs
`receipts/<shop_id>/<sale_id>.json` incluant `shop.currency` tel quel
(donc potentiellement un symbole).

**Cette fonction n'était référencée nulle part** (`functions.invoke` = 0
occurrence, absente de `supabase/config.toml`) — elle n'a
**probablement jamais tourné en production**, et le bucket `receipts`
n'est lu par aucun code actuel. Le risque concret est donc
**vraisemblablement nul**, mais **non formellement vérifié**.

→ C'est le seul point à lever avant de retirer la tolérance (§14.3) :
inventorier le bucket `receipts` et confirmer qu'il est vide ou absent.

---

## 16. Recommandations pour une éventuelle V4

Aucune V4 n'est nécessaire à court terme. Pistes si le besoin apparaît :

1. **Table `currencies` + clé étrangère** (au lieu du `CHECK`) — si une
   UI admin de gestion des devises devient utile (activer/désactiver,
   ajouter sans migration). Le registre `lib/saas/currencies.ts`
   deviendrait un cache / seed. Coût : RLS, seed, synchronisation.
2. **Devise par transaction** — aujourd'hui `sales` / `payments` /
   `expenses` héritent de `shops.currency`. Si une boutique doit un jour
   encaisser dans plusieurs devises, il faudra une colonne `currency`
   sur ces tables + un taux figé à la transaction. Chantier lourd
   (historique, reporting, reçus).
3. **`decimals` réellement appliqués à l'arrondi métier** — actuellement
   XAF/XOF (0 décimale) sont arrondis à l'affichage ; vérifier que la
   saisie et le stockage respectent aussi la convention (pas de
   `1234.56 XAF` en base).
4. **Nettoyage de la dette §13** — une fois la checklist §14 validée.
5. **`currency_code_for_country` (SQL)** — la générer depuis
   `lib/saas/countries.ts` (script de build) plutôt que la maintenir à
   la main, pour éliminer le risque de divergence.
6. **Passerelles de paiement (§17 du cahier V3)** — si de nouveaux
   fournisseurs sont ajoutés, s'assurer que la couche d'adaptation
   envoie bien le **code ISO attendu par le fournisseur** (`XAF` /
   `XOF`), jamais le symbole `« F CFA »`.

---

## Annexe — Fichiers clés

| Fichier | Rôle |
|---|---|
| `lib/saas/currencies.ts` | registre central + `normalizeCurrency` / `resolveCurrencyCode` / `displayMetaFor` |
| `lib/utils/currency.ts` | `formatCurrency` + `formatMoneyByCurrency` + dérivés |
| `lib/hooks/use-currency.ts` | hook boutique active |
| `lib/saas/countries.ts` | 26 pays → devise (source des `countries[]` du registre) |
| `supabase/migrations/137_referral_wallet_currency_fix.sql` | `currency_code_for_country()` |
| `supabase/migrations/141_shops_currency_iso.sql` | migration de données (Phase B) |
| `supabase/migrations/142_shops_currency_constraint.sql` | verrou de schéma (Phase E) |
| `docs/CURRENCY_V3_MIGRATION_REPORT.md` | ce document |
