'use client'

import { useState } from 'react'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface ProductThumbnailProps {
  src?: string | null
  alt: string
  className?: string
  iconClassName?: string
}

// Single shared product image slot — always reserves the same space (a
// missing image and a broken image both fall back to the same neutral
// placeholder) so a product grid/list never looks visually inconsistent
// depending on which items happen to have a photo.
export function ProductThumbnail({ src, alt, className, iconClassName }: ProductThumbnailProps) {
  const [errored, setErrored] = useState(false)
  const showImage = !!src && !errored

  return (
    <div className={cn('flex items-center justify-center bg-muted rounded-lg border border-border overflow-hidden shrink-0', className)}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <Package className={cn('h-1/2 w-1/2 text-muted-foreground/40', iconClassName)} />
      )}
    </div>
  )
}
