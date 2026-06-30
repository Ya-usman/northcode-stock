'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, MessageCircle, Mail, BookOpen, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import Image from 'next/image'

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQ = [
  {
    category: 'Démarrage',
    items: [
      {
        q: 'Comment ajouter mon premier produit ?',
        a: 'Allez dans Stock → cliquez sur "Ajouter un produit". Renseignez le nom, prix d\'achat, prix de vente et quantité. Le produit apparaît immédiatement dans votre stock.',
      },
      {
        q: 'Comment enregistrer une vente ?',
        a: 'Allez dans Ventes (icône panier). Recherchez le produit, ajustez la quantité, choisissez le mode de paiement et cliquez "Finaliser la vente". Le stock se met à jour automatiquement.',
      },
      {
        q: 'Comment inviter un employé ?',
        a: 'Allez dans Équipe → "Inviter un employé". Entrez son adresse e-mail et choisissez son rôle (Caissier, Gestionnaire de stock, etc.). Il recevra un lien par e-mail.',
      },
    ],
  },
  {
    category: 'Paiements & Abonnement',
    items: [
      {
        q: 'Comment payer mon abonnement ?',
        a: 'Allez dans Abonnement → choisissez votre plan. Pour le Nigeria, paiement via Paystack (carte, USSD, virement). Pour le Cameroun, paiement via MTN MoMo ou Orange Money.',
      },
      {
        q: 'Que se passe-t-il si mon abonnement expire ?',
        a: 'Vos données sont conservées en sécurité. Vous ne pourrez plus créer de nouvelles ventes jusqu\'au renouvellement. Aucune donnée n\'est supprimée.',
      },
      {
        q: 'Puis-je changer de plan ?',
        a: 'Oui, à tout moment depuis la page Abonnement. Le changement est immédiat.',
      },
    ],
  },
  {
    category: 'Stock & Produits',
    items: [
      {
        q: 'Comment configurer les alertes de stock faible ?',
        a: 'Lors de l\'ajout ou modification d\'un produit, renseignez le champ "Alerte stock faible à". Vous serez notifié quand la quantité passe en dessous de ce seuil.',
      },
      {
        q: 'Comment faire un réapprovisionnement ?',
        a: 'Dans Stock, cliquez sur un produit → icône "Réapprovisionner". Entrez la quantité reçue. Le mouvement est enregistré dans l\'historique.',
      },
      {
        q: 'Comment exporter mon stock en PDF ou CSV ?',
        a: 'Dans Stock → cliquez sur "Exporter PDF" ou "Exporter CSV" en haut à droite. Le fichier se télécharge immédiatement.',
      },
    ],
  },
  {
    category: 'Crédits & Clients',
    items: [
      {
        q: 'Comment vendre à crédit ?',
        a: 'Lors d\'une vente, choisissez "Crédit (dette)" comme mode de paiement. La vente est enregistrée et la dette apparaît dans la section Paiements.',
      },
      {
        q: 'Comment enregistrer un remboursement de crédit ?',
        a: 'Allez dans Paiements → trouvez le client → cliquez "Enregistrer le paiement". Entrez le montant reçu.',
      },
    ],
  },
  {
    category: 'Technique',
    items: [
      {
        q: 'L\'application fonctionne-t-elle sans internet ?',
        a: 'Oui. StockShop fonctionne en mode hors ligne. Les données se synchronisent automatiquement quand la connexion est rétablie.',
      },
      {
        q: 'Comment changer la langue ?',
        a: 'Allez dans Paramètres → Langue. Choisissez entre Anglais, Français et Haoussa.',
      },
      {
        q: 'Mes données sont-elles sécurisées ?',
        a: 'Oui. Toutes vos données sont chiffrées et stockées sur des serveurs sécurisés (Supabase). Nous ne partageons jamais vos données avec des tiers.',
      },
    ],
  },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-foreground hover:text-stockshop-blue dark:hover:text-blue-400 transition-colors"
      >
        <span>{q}</span>
        {open
          ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-stockshop-blue dark:text-blue-400" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      </button>
      {open && <p className="pb-3 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  )
}

// ── MANUAL ────────────────────────────────────────────────────────────────────

interface Callout { type?: 'info' | 'warning' | 'success'; text: string }
interface ScreenBlock {
  title: string
  description?: string
  image: string
  alt: string
  reverse?: boolean
  tips: string[]
  callouts?: Callout[]
}
interface ManualSection {
  id: string
  num: number
  title: string
  blocks: ScreenBlock[]
  extra?: React.ReactNode
}

function CalloutBox({ type = 'info', text }: Callout) {
  const cls = {
    info:    'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-800 dark:text-blue-300',
    warning: 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-800 dark:text-amber-300',
    success: 'bg-green-50 dark:bg-green-950/40 border-green-500 text-green-800 dark:text-green-300',
  }[type]
  return (
    <div className={cn('border-l-4 rounded-r-lg px-3 py-2 text-xs mt-3 leading-relaxed', cls)}>
      {text}
    </div>
  )
}

function ScreenRow({ block }: { block: ScreenBlock }) {
  return (
    <div className={cn('flex gap-5 items-start', block.reverse ? 'flex-row-reverse' : 'flex-row',
      'max-sm:flex-col')}>
      <div className="shrink-0 w-[160px] max-sm:w-full">
        <Image
          src={`/manual/${block.image}`}
          alt={block.alt}
          width={360}
          height={780}
          className="rounded-2xl border-4 border-border shadow-lg w-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-[15px] text-stockshop-blue dark:text-blue-400 mb-2">{block.title}</h3>
        {block.description && <p className="text-sm text-muted-foreground mb-2">{block.description}</p>}
        <ul className="space-y-1.5 text-sm text-foreground/80">
          {block.tips.map((tip, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-stockshop-blue dark:text-blue-400 font-bold mt-0.5">•</span>
              <span dangerouslySetInnerHTML={{ __html: tip }} />
            </li>
          ))}
        </ul>
        {block.callouts?.map((c, i) => <CalloutBox key={i} {...c} />)}
      </div>
    </div>
  )
}

const SECTIONS: ManualSection[] = [
  {
    id: 's1', num: 1, title: 'Tableau de bord',
    blocks: [{
      title: 'Vue d\'ensemble en temps réel',
      image: 'dashboard.png', alt: 'Tableau de bord',
      description: 'Le tableau de bord est la première page après connexion. Il affiche toutes les informations clés de votre journée en un coup d\'œil.',
      tips: [
        '<strong>Revenus du jour</strong> — Total encaissé aujourd\'hui.',
        '<strong>Ventes aujourd\'hui</strong> — Nombre de transactions.',
        '<strong>Alertes stock</strong> — Produits en stock faible.',
        '<strong>Dettes en cours</strong> — Total des crédits non remboursés.',
        '<strong>Dépenses aujourd\'hui</strong> — Visible pour le propriétaire uniquement.',
      ],
      callouts: [
        { type: 'info', text: '💡 Appuyez sur ↻ en haut à droite pour rafraîchir manuellement.' },
        { type: 'warning', text: '⚠️ Si vous avez plusieurs boutiques, utilisez le sélecteur « Toutes les boutiques » pour filtrer.' },
      ],
    }],
  },
  {
    id: 's2', num: 2, title: 'Nouvelle vente — Point de vente',
    blocks: [{
      title: 'Créer une vente',
      image: 'new-sale.png', alt: 'Point de vente', reverse: true,
      description: 'Appuyez sur « Nouvelle vente » dans la barre de navigation du bas.',
      tips: [
        '<strong>Sélectionner la boutique</strong> — Si plusieurs boutiques, choisissez en haut.',
        '<strong>Chercher un produit</strong> — Tapez le nom, le SKU ou scannez le code-barres.',
        '<strong>Filtrer par catégorie</strong> — Appuyez sur une catégorie pour filtrer.',
        '<strong>Ajouter au panier</strong> — Appuyez sur le produit.',
      ],
      callouts: [
        { type: 'info', text: '💡 Le badge vert sur chaque produit indique la quantité disponible.' },
        { type: 'success', text: '✅ Faites défiler vers le bas pour voir le panier et finaliser la vente (mode de paiement, montant reçu, etc.).' },
      ],
    }],
  },
  {
    id: 's3', num: 3, title: 'Gestion du stock',
    blocks: [{
      title: 'Liste des produits',
      image: 'stock.png', alt: 'Stock',
      description: 'La page Stock affiche tous vos produits avec leur prix de vente, prix d\'achat et quantité.',
      tips: [
        '<strong>Rechercher</strong> — Par nom ou SKU.',
        '<strong>Filtrer</strong> — Par catégorie ou statut (En stock, Alerte, Rupture).',
        '<strong>Ajouter un produit</strong> — Bouton bleu « + Ajouter un produit ».',
        '<strong>Réapprovisionner</strong> — « ↓ Réapprovisionner » pour ajouter du stock.',
        '<strong>Modifier ✏️</strong> — Modifier les informations du produit.',
        '<strong>Exporter CSV</strong> — Exportez votre stock en tableur.',
      ],
      callouts: [
        { type: 'warning', text: '⚠️ Produits en orange = stock faible. Produits en rouge = rupture.' },
      ],
    }],
  },
  {
    id: 's4', num: 4, title: 'Rapports',
    blocks: [
      {
        title: 'Résumé financier',
        image: 'reports-summary.png', alt: 'Rapports - résumé', reverse: true,
        description: 'Vision complète de la performance de votre boutique sur une période choisie.',
        tips: [
          '<strong>Période</strong> — Aujourd\'hui, Cette semaine, Ce mois, Ce trimestre…',
          '<strong>Encaissé</strong> — Total réellement perçu.',
          '<strong>Dépenses</strong> — Total des dépenses sur la période.',
          '<strong>Bénéfice net</strong> — Encaissé moins les dépenses.',
          '<strong>Dettes en cours</strong> — Crédits clients non remboursés.',
        ],
      },
      {
        title: 'Revenus par paiement & Top produits',
        image: 'reports-top.png', alt: 'Rapports - top produits',
        tips: [
          '<strong>Graphique circulaire</strong> — Répartition des encaissements par mode de paiement.',
          '<strong>Produits les plus vendus</strong> — Top 10 par chiffre d\'affaires.',
        ],
        callouts: [
          { type: 'info', text: '💡 Appuyez sur « Télécharger le PDF » en haut pour exporter un rapport imprimable.' },
        ],
      },
      {
        title: 'Dépenses & Performance des caissiers',
        image: 'reports-expenses.png', alt: 'Rapports - caissiers', reverse: true,
        tips: [
          '<strong>Tableau des dépenses</strong> — Date, description, montant.',
          '<strong>Performance des caissiers</strong> — Classement par ventes et chiffre d\'affaires.',
          'En multi-boutiques, le badge « Classement toutes boutiques » s\'affiche.',
        ],
      },
    ],
  },
  {
    id: 's5', num: 5, title: 'Historique des ventes',
    blocks: [{
      title: 'Consulter et gérer les ventes passées',
      image: 'sales-history.png', alt: 'Historique des ventes',
      description: 'Toutes les ventes filtrées par date, boutique, caissier ou statut de paiement.',
      tips: [
        '<strong>Onglet Ventes</strong> — Toutes les ventes actives.',
        '<strong>Onglet Remboursements</strong> — Paiements de dettes clients.',
        '<strong>Recherche</strong> — Par numéro de vente ou nom de client.',
        '<strong>Numéro de vente</strong> — Chaque vente a un numéro unique.',
        '<strong>Statut « Payé »</strong> — Badge vert = intégralement payé.',
        '<strong>Exporter CSV</strong> — Bouton CSV pour exporter l\'historique.',
      ],
      callouts: [
        { type: 'info', text: '💡 Appuyez sur la flèche ▾ d\'une vente pour voir le détail des articles.' },
      ],
    }],
  },
  {
    id: 's6', num: 6, title: 'Clients',
    blocks: [{
      title: 'Gérer votre carnet clients',
      image: 'customers.png', alt: 'Clients', reverse: true,
      description: 'Enregistrez vos clients fidèles pour leur vendre à crédit et suivre leurs dettes.',
      tips: [
        '<strong>Ajouter un client</strong> — Bouton « + Ajouter un client » en haut à droite.',
        '<strong>Rechercher</strong> — Par nom ou numéro de téléphone.',
        '<strong>Badge rouge</strong> — Affiche la dette en cours du client.',
        '<strong>Supprimer 🗑️</strong> — Impossible si le client a une dette active.',
      ],
      callouts: [
        { type: 'warning', text: '⚠️ Pour vendre à crédit, sélectionnez le client et choisissez « Crédit » comme mode de paiement.' },
      ],
    }],
  },
  {
    id: 's7', num: 7, title: 'Mouvements de stock',
    blocks: [{
      title: 'Historique des réapprovisionnements',
      image: 'movements.png', alt: 'Mouvements de stock',
      description: 'Consultez l\'historique complet de tous les ajouts de stock.',
      tips: [
        '<strong>Total restocké</strong> — Nombre total d\'unités ajoutées.',
        '<strong>Produits suivis</strong> — Nombre de produits actifs.',
        '<strong>Tableau</strong> — Stock initial, réapprovisionnements cumulés, stock actuel.',
        '<strong>Recherche</strong> — Par nom de produit ou d\'employé.',
        '<strong>Filtre date</strong> — Mouvements sur une plage de dates.',
      ],
    }],
  },
  {
    id: 's8', num: 8, title: 'Catégories de produits',
    blocks: [{
      title: 'Organiser vos produits',
      image: 'categories.png', alt: 'Catégories', reverse: true,
      description: 'Les catégories permettent de classer vos produits et de les retrouver rapidement lors d\'une vente.',
      tips: [
        '<strong>Ajouter une catégorie</strong> — Bouton « + Ajouter ».',
        '<strong>Badge numérique</strong> — Indique le nombre de produits dans la catégorie.',
        '<strong>Restaurer ↺</strong> — Restaure les catégories par défaut.',
        '<strong>Supprimer 🗑️</strong> — Supprime la catégorie (les produits perdent leur catégorie).',
      ],
      callouts: [
        { type: 'info', text: '💡 En mode multi-boutiques, les catégories sont affichées par boutique.' },
      ],
    }],
  },
  {
    id: 's9', num: 9, title: 'Fournisseurs',
    blocks: [{
      title: 'Gérer vos fournisseurs',
      image: 'suppliers.png', alt: 'Fournisseurs',
      description: 'Enregistrez vos fournisseurs pour les associer à vos produits.',
      tips: [
        '<strong>Ajouter un fournisseur</strong> — Bouton « + Ajouter un fournisseur ».',
        '<strong>Informations</strong> — Nom, téléphone, ville, produits liés.',
        '<strong>Modifier ✏️</strong> — Mettre à jour les informations.',
        '<strong>Supprimer 🗑️</strong> — Impossible si des produits sont liés.',
      ],
    }],
  },
  {
    id: 's10', num: 10, title: 'Dépenses',
    blocks: [{
      title: 'Suivi des dépenses (propriétaire uniquement)',
      image: 'expenses.png', alt: 'Dépenses', reverse: true,
      description: 'Enregistrez toutes les dépenses de votre boutique : loyer, salaires, électricité…',
      tips: [
        '<strong>Filtre par mois</strong> — Sélecteur en haut à gauche.',
        '<strong>Total du mois</strong> — Récapitulatif des dépenses du mois.',
        '<strong>Ajouter une dépense</strong> — Montant, description, date.',
        '<strong>Modifier ✏️</strong> — Corriger une dépense saisie par erreur.',
        '<strong>Supprimer 🗑️</strong> — Supprimer une dépense.',
      ],
      callouts: [
        { type: 'success', text: '✅ Les dépenses apparaissent automatiquement dans les Rapports et le Tableau de bord.' },
      ],
    }],
  },
  {
    id: 's11', num: 11, title: 'Gestion de l\'équipe',
    blocks: [{
      title: 'Gérer vos collaborateurs',
      image: 'team.png', alt: 'Équipe',
      description: 'Invitez des membres et gérez leurs rôles et accès.',
      tips: [
        '<strong>Inviter</strong> — Envoyez une invitation par email à un nouveau membre.',
        '<strong>Rôles</strong> — Propriétaire, Caissier, Gestionnaire stock, Viewer.',
        '<strong>Statut</strong> — Badge vert = En ligne, badge jaune = Absent.',
        '<strong>Désactiver</strong> — Empêche temporairement le membre de se connecter.',
        '<strong>Supprimer 🗑️</strong> — Retire définitivement un membre.',
      ],
      callouts: [
        { type: 'info', text: '💡 Sélectionnez la boutique avec le sélecteur en haut pour voir les membres de chaque boutique.' },
      ],
    }],
  },
  {
    id: 's12', num: 12, title: 'Mes boutiques',
    blocks: [{
      title: 'Gérer plusieurs boutiques',
      image: 'shops.png', alt: 'Mes boutiques', reverse: true,
      description: 'Si votre plan le permet, créez et gérez plusieurs boutiques depuis un seul compte.',
      tips: [
        '<strong>Nouvelle boutique</strong> — Bouton « + Nouvelle boutique ».',
        '<strong>Boutique active</strong> — Encadrée en bleu avec le badge « Active ».',
        '<strong>Changer de boutique</strong> — Bouton « Changer ».',
        '<strong>Informations</strong> — Ville, membres, plan actif.',
      ],
      callouts: [
        { type: 'info', text: '💡 Depuis le tableau de bord, utilisez le sélecteur pour voir toutes vos boutiques.' },
      ],
    }],
  },
  {
    id: 's13', num: 13, title: 'Abonnement',
    blocks: [
      {
        title: 'Choisir ou renouveler son plan',
        image: 'billing-plans.png', alt: 'Abonnement - plans',
        tips: [
          '<strong>Starter</strong> — 1 boutique, 2 employés, export CSV & PDF, 90 jours d\'historique.',
          '<strong>Pro</strong> — 2 boutiques, 5 employés, reçus WhatsApp, 1 an d\'historique.',
          '<strong>Business</strong> — 10 boutiques, 30 employés, historique complet, support dédié.',
        ],
      },
      {
        title: 'Questions fréquentes',
        image: 'billing-faq.png', alt: 'Abonnement - FAQ', reverse: true,
        tips: [
          'Vos données sont conservées même si votre plan expire.',
          'Vous pouvez changer de plan à tout moment.',
          'Paiement sécurisé via <strong>Paystack</strong>, <strong>Flutterwave</strong> ou <strong>NotchPay</strong>.',
        ],
        callouts: [
          { type: 'success', text: '✅ L\'activation est instantanée après paiement.' },
        ],
      },
    ],
  },
  {
    id: 's14', num: 14, title: 'Paramètres',
    blocks: [
      {
        title: 'Informations de la boutique',
        image: 'settings.png', alt: 'Paramètres - boutique',
        tips: [
          '<strong>Logo</strong> — Changer le logo (affiché sur les reçus).',
          '<strong>Nom de la boutique</strong> — Modifiable à tout moment.',
          '<strong>Numéro WhatsApp</strong> — Pour envoyer les reçus (plan Pro et +).',
          '<strong>Seuil d\'alerte stock</strong> — Quantité sous laquelle une alerte est déclenchée.',
          '<strong>Taux de taxe</strong> — Appliqué lors des ventes (0 = aucune taxe).',
        ],
      },
      {
        title: 'Langue & Accès par rôle',
        image: 'settings-perms.png', alt: 'Paramètres - permissions', reverse: true,
        tips: [
          '<strong>Langue</strong> — Français, English ou Hausa.',
          '<strong>Accès par rôle</strong> — Définissez ce que chaque rôle peut voir (Caissier, Viewer, Gestionnaire stock).',
          'Activez/désactivez chaque fonctionnalité avec les interrupteurs.',
        ],
        callouts: [
          { type: 'warning', text: '⚠️ Les permissions prennent effet immédiatement pour tous les membres connectés.' },
        ],
      },
    ],
  },
  {
    id: 's15', num: 15, title: 'Menu « Plus »',
    blocks: [{
      title: 'Accéder à toutes les fonctionnalités',
      image: 'menu-more.png', alt: 'Menu Plus',
      description: 'Le bouton « ··· Plus » dans la barre de navigation du bas ouvre un panneau contenant toutes les fonctionnalités.',
      tips: [
        'Historique des ventes, Dettes, Clients',
        'Mouvements de stock, Catégories, Fournisseurs',
        'Dépenses, Équipe, Boutiques',
        'Abonnement, Paramètres',
      ],
      callouts: [
        { type: 'info', text: '💡 Appuyez n\'importe où en dehors du panneau pour le fermer.' },
      ],
    }],
  },
]

const TOC_ITEMS = SECTIONS.map(s => ({ id: s.id, num: s.num, title: s.title }))

function ManualContent() {
  return (
    <div className="space-y-4">
      {/* Table des matières */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-stockshop-blue dark:text-blue-400 mb-3">
          📋 Table des matières
        </h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {TOC_ITEMS.map(item => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="text-sm text-stockshop-blue dark:text-blue-400 hover:underline font-medium"
              >
                {item.num}. {item.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* Sections */}
      {SECTIONS.map(section => (
        <div key={section.id} id={section.id} className="rounded-xl border bg-card shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 bg-stockshop-blue">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white font-bold text-sm shrink-0">
              {section.num}
            </span>
            <h2 className="font-bold text-white text-[15px]">{section.title}</h2>
          </div>

          {/* Body */}
          <div className="p-5 space-y-6">
            {section.blocks.map((block, i) => (
              <div key={i}>
                {i > 0 && <hr className="border-border mb-6" />}
                <ScreenRow block={block} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground py-4">
        Manuel d'utilisation StockShop · Version 1.0 · 2026 · <strong className="text-stockshop-blue dark:text-blue-400">NorthCode</strong>
      </div>
    </div>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

type Tab = 'faq' | 'manual'

export default function HelpPage() {
  const [tab, setTab] = useState<Tab>('faq')

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h1 className="font-bold text-lg mb-1">Aide & Documentation</h1>
        <p className="text-sm text-muted-foreground">FAQ rapide ou manuel complet illustré.</p>

        {/* Tab switcher */}
        <div className="flex mt-4 rounded-lg border bg-muted p-1 gap-1">
          <button
            onClick={() => setTab('faq')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors',
              tab === 'faq'
                ? 'bg-card text-stockshop-blue dark:text-blue-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <HelpCircle className="h-4 w-4" />
            FAQ
          </button>
          <button
            onClick={() => setTab('manual')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors',
              tab === 'manual'
                ? 'bg-card text-stockshop-blue dark:text-blue-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <BookOpen className="h-4 w-4" />
            Manuel
          </button>
        </div>
      </div>

      {/* FAQ tab */}
      {tab === 'faq' && (
        <>
          {FAQ.map(({ category, items }) => (
            <div key={category} className="rounded-xl border bg-card p-5 shadow-sm">
              <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-stockshop-blue dark:text-blue-400">
                {category}
              </h2>
              <div>
                {items.map(item => <FAQItem key={item.q} {...item} />)}
              </div>
            </div>
          ))}

          {/* Contact */}
          <div className="rounded-xl border bg-stockshop-blue text-white p-5 shadow-sm">
            <h2 className="font-semibold mb-1">Vous n'avez pas trouvé votre réponse ?</h2>
            <p className="text-sm text-blue-100 mb-4">Notre équipe répond en moins de 24h.</p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://wa.me/message/stockshop"
                className="flex items-center gap-2 rounded-lg bg-card text-stockshop-blue dark:text-blue-400 px-4 py-2 text-sm font-medium hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
              <a
                href="mailto:support@stockshop.africa"
                className="flex items-center gap-2 rounded-lg bg-white/10 text-white px-4 py-2 text-sm font-medium hover:bg-white/20 transition-colors"
              >
                <Mail className="h-4 w-4" />
                support@stockshop.africa
              </a>
            </div>
          </div>
        </>
      )}

      {/* Manual tab */}
      {tab === 'manual' && <ManualContent />}
    </div>
  )
}
