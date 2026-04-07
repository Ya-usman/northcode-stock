import { createAdminClient } from '@/lib/supabase/server'
import { ArrowLeftRight } from 'lucide-react'

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'En attente', cls: 'bg-amber-900/50 text-amber-400' },
  in_transit: { label: 'En transit', cls: 'bg-blue-900/50 text-blue-400' },
  received:   { label: 'Reçu',       cls: 'bg-green-900/50 text-green-400' },
  cancelled:  { label: 'Annulé',     cls: 'bg-red-900/50 text-red-400' },
}

export default async function AdminTransfersPage() {
  const supabase = await createAdminClient()

  const { data: transfers } = await supabase
    .from('stock_transfers')
    .select('*, from_shop:from_shop_id(name, city), to_shop:to_shop_id(name, city), product:product_id(name, unit)')
    .order('created_at', { ascending: false })
    .limit(200)

  const list = (transfers ?? []) as any[]

  const total = list.length
  const received = list.filter(t => t.status === 'received').length
  const pending = list.filter(t => t.status === 'pending').length
  const inTransit = list.filter(t => t.status === 'in_transit').length

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Transferts inter-boutiques</h1>
        <p className="text-gray-400 text-sm mt-1">Tous les mouvements entre boutiques</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, color: 'text-white' },
          { label: 'En attente', value: pending, color: 'text-amber-400' },
          { label: 'En transit', value: inTransit, color: 'text-blue-400' },
          { label: 'Reçus', value: received, color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
            <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Bordereau</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Produit</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">De</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Vers</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Qté</th>
                <th className="text-center px-4 py-3 text-xs text-gray-500 font-medium">Statut</th>
                <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                    Aucun transfert enregistré
                  </td>
                </tr>
              ) : list.map((t) => {
                const s = STATUS_LABELS[t.status] ?? STATUS_LABELS.pending
                return (
                  <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-northcode-blue">{t.transfer_number ?? '—'}</span>
                      {t.bordereau_ref && (
                        <span className="block text-[10px] text-gray-500">{t.bordereau_ref}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-white">
                      {t.product?.name ?? t.product_name}
                      <span className="text-gray-500 text-xs ml-1">{t.product?.unit}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs">{t.from_shop?.name ?? '?'}<span className="text-gray-600"> — {t.from_shop?.city}</span></td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs">{t.to_shop?.name ?? '?'}<span className="text-gray-600"> — {t.to_shop?.city}</span></td>
                    <td className="px-4 py-2.5 text-right font-bold text-white">{t.quantity}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                      {new Date(t.created_at).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
