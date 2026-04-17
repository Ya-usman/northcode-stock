import { WifiOff } from 'lucide-react'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-northcode-blue-muted mb-6">
        <WifiOff className="h-10 w-10 text-northcode-blue" />
      </div>
      <h1 className="text-2xl font-bold text-northcode-blue mb-2">You're offline</h1>
      <p className="text-muted-foreground max-w-sm">
        Ba ka da intanet. Some features are limited. Cached stock data is still available.
      </p>
      <p className="text-sm text-muted-foreground mt-4">StockShop Manager</p>
    </div>
  )
}
