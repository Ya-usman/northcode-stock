import { WifiOff } from 'lucide-react'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40 mb-6">
        <WifiOff className="h-10 w-10 text-northcode-blue dark:text-blue-400" />
      </div>
      <h1 className="text-2xl font-bold text-northcode-blue dark:text-blue-400 mb-2">You're offline</h1>
      <p className="text-muted-foreground max-w-sm">
        Ba ka da intanet. Some features are limited. Cached stock data is still available.
      </p>
      <p className="text-sm text-muted-foreground mt-4">StockShop Manager</p>
    </div>
  )
}
