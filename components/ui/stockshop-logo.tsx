interface StockShopLogoProps {
  /** Diameter of the S circle in px. Text scales proportionally. */
  iconSize?: number
  /** 'blue' = blue circle + blue text on light bg. 'white' = white circle + white text on dark bg. */
  variant?: 'blue' | 'white'
  showText?: boolean
  className?: string
}

const BRAND = '#073e8a'

export function StockShopLogo({
  iconSize = 32,
  variant = 'blue',
  showText = true,
  className = '',
}: StockShopLogoProps) {
  const isWhite = variant === 'white'
  const circleBg = isWhite ? 'white' : BRAND
  const letterColor = isWhite ? BRAND : 'white'
  const textColor = isWhite ? 'white' : BRAND

  return (
    <div
      className={`flex items-center ${className}`}
      style={{ gap: Math.round(iconSize * 0.28) }}
    >
      {/* S circle */}
      <div
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: '50%',
          backgroundColor: circleBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: isWhite ? '0 0 0 1.5px rgba(255,255,255,0.25)' : undefined,
        }}
      >
        <span
          style={{
            color: letterColor,
            fontSize: Math.round(iconSize * 0.56),
            fontWeight: 800,
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          S
        </span>
      </div>

      {showText && (
        <span
          style={{
            color: textColor,
            fontSize: Math.round(iconSize * 0.58),
            fontWeight: 600,
            letterSpacing: '0.07em',
            lineHeight: 1,
          }}
        >
          STOCKSHOP
        </span>
      )}
    </div>
  )
}
