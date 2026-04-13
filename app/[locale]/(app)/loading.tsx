export default function AppLoading() {
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-gray-200 animate-pulse" />
        ))}
      </div>
      <div className="h-10 rounded-lg bg-gray-200 animate-pulse" />
      <div className="h-52 rounded-lg bg-gray-200 animate-pulse" />
    </div>
  )
}
