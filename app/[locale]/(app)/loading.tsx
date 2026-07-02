// Neutral skeleton: title + filter bar + list rows.
// Avoids the dashboard-card shape mismatch on list pages (stock, customers, etc.).
export default function AppLoading() {
  return (
    <div className="space-y-4 p-4 pt-6">
      <div className="h-7 w-36 rounded-lg bg-muted animate-pulse" />
      <div className="h-10 rounded-lg bg-muted animate-pulse" />
      <div className="space-y-2">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
