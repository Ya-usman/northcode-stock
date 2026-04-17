'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, MessageCircle, Mail } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

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
        className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-gray-900 hover:text-northcode-blue transition-colors"
      >
        <span>{q}</span>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-northcode-blue" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <p className="pb-3 text-sm text-muted-foreground leading-relaxed">{a}</p>
      )}
    </div>
  )
}

export default function HelpPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="font-bold text-lg mb-1">Aide & FAQ</h1>
        <p className="text-sm text-muted-foreground">Trouvez rapidement une réponse à votre question.</p>
      </div>

      {FAQ.map(({ category, items }) => (
        <div key={category} className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3 text-sm uppercase tracking-wide text-northcode-blue">{category}</h2>
          <div>
            {items.map(item => <FAQItem key={item.q} {...item} />)}
          </div>
        </div>
      ))}

      {/* Contact */}
      <div className="rounded-xl border bg-northcode-blue text-white p-5 shadow-sm">
        <h2 className="font-semibold mb-1">Vous n'avez pas trouvé votre réponse ?</h2>
        <p className="text-sm text-blue-100 mb-4">Notre équipe répond en moins de 24h.</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://wa.me/message/northcode"
            className="flex items-center gap-2 rounded-lg bg-white text-northcode-blue px-4 py-2 text-sm font-medium hover:bg-blue-50 transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
          <a
            href="mailto:support@northcode.africa"
            className="flex items-center gap-2 rounded-lg bg-white/10 text-white px-4 py-2 text-sm font-medium hover:bg-white/20 transition-colors"
          >
            <Mail className="h-4 w-4" />
            support@northcode.africa
          </a>
        </div>
      </div>
    </div>
  )
}
