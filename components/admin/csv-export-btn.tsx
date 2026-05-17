'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface Props {
  href: string
  label?: string
}

export function CsvExportBtn({ href, label = 'Exporter CSV' }: Props) {
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    setLoading(true)
    try {
      const res = await fetch(href)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {}
    setLoading(false)
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border bg-card rounded-lg hover:bg-accent text-foreground disabled:opacity-50 transition-colors"
    >
      <Download className="h-3.5 w-3.5" />
      {loading ? 'Export…' : label}
    </button>
  )
}
