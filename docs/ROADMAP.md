# Feuille de route StockShop

Évolutions décidées mais pas encore développées. Chaque entrée indique la
règle à respecter et ce qui existe déjà dans le code.

## Règle : un membre = une personne physique

Décidée le 5 octobre 2026. Un compte StockShop appartient à une seule personne
identifiable. Les comptes partagés entre plusieurs personnes sont interdits,
qu'ils portent un nom de groupe (« Équipe caisse », « Staff Akwa ») ou des
prénoms réunis (« Amadou & Mamadou »).

Pourquoi : quotas, permissions, journal d'audit, performance par employé et
responsabilité des actions reposent tous sur l'identifiant de la personne. Un
compte partagé rend impossible de savoir qui a vendu, annulé, remboursé,
modifié un prix, ajusté ou transféré du stock, ou changé un rôle. C'est une
règle de sécurité, pas seulement une règle commerciale.

| Autorisé | Interdit |
|---|---|
| Un téléphone, une tablette ou une caisse utilisés par plusieurs personnes | Un même compte utilisé par plusieurs personnes |

Déjà en place :

- Rappel de la règle dans l'invitation et l'affectation d'un membre.
- Avertissement doux, jamais bloquant, si le nom ou l'adresse e-mail
  ressemble à un groupe ou à la boutique : `lib/team/shared-account-signals.ts`.
- Quota d'équipe : une personne distincte = un siège, propriétaire non compté,
  quel que soit le nombre de boutiques (`lib/saas/team-quota.ts`).

Un compte partagé reste techniquement un seul identifiant et consomme un seul
siège : le quota ne suffit donc pas à garantir l'usage individuel.

## Terminal de caisse partagé (à développer)

Objectif : plusieurs caissiers sur un même appareil, chacun identifié.

1. L'appareil est ouvert une fois dans la boutique (session « terminal »,
   sans droits propres).
2. Avant une vente, la personne se sélectionne dans la liste des membres de
   la boutique.
3. Elle saisit son code PIN personnel (4 à 6 chiffres, distinct du mot de
   passe, stocké haché, réinitialisable par le propriétaire ou le responsable).
4. La session de la personne est courte : fin après la vente, après quelques
   minutes d'inactivité, ou sur « Changer d'utilisateur ».
5. Chaque action (vente, paiement, annulation, mouvement de stock) est
   enregistrée avec l'identifiant de la personne, jamais celui du terminal.

Points à trancher le moment venu : nombre d'essais de PIN, verrouillage,
fonctionnement hors ligne, actions sensibles demandant le PIN d'un responsable.

## Signalement « compte potentiellement partagé » (à développer)

Liste admin non bloquante, sans surveillance intrusive. La fonction
`sharedAccountSignals` produit déjà deux signaux (nom collectif, e-mail de la
boutique). Signaux pouvant s'ajouter plus tard, sans changer les appelants :
connexions simultanées, appareils très différents, localisations
incompatibles, usage anormalement large pour le rôle. Aucun de ces signaux
n'est collecté aujourd'hui.

## Siège d'équipe supplémentaire (en réserve)

Mécanisme possible pour un geste commercial réel : un nombre de sièges ajouté
à la limite de la formule, pour un compte, avec motif, date de fin et trace
dans le journal. Non développé. À ne pas utiliser pour régulariser un compte
partagé : on retire le compte partagé à la place.

## Comptes techniques

StockShop n'a aujourd'hui aucun compte technique ou système. S'il en fallait
un, il devrait avoir un type explicite, ne consommer aucun siège humain et ne
pas permettre de connexion interactive.
