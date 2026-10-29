'use client'

// Réception d'un transfert (Stock › Transferts V1). Ouverte depuis la liste, ou par le QR du bon (adresse avec le
// jeton « k ») : la page revérifie tout auprès du serveur et ne réceptionne qu'après confirmation explicite.
import { useSearchParams } from 'next/navigation'
import { TransferReceive } from '@/components/stock/transfers/transfer-receive'

export default function TransferReceivePage({ params }: { params: { id: string } }) {
  const search = useSearchParams()
  const k = search.get('k')
  return <TransferReceive id={params.id} token={k && /^[0-9a-f]{64}$/i.test(k) ? k.toLowerCase() : null} />
}
