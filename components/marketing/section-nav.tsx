'use client'

// Pastilles collantes de la page Plateforme : la pastille active suit la lecture et reste visible dans la rangée qui
// défile sur téléphone. Section active = la dernière dont le haut a passé la ligne de lecture (juste sous l'en-tête et
// les pastilles) ; en bas de page, la dernière section. Un seul calcul par image affichée pendant le défilement.
import { useEffect, useRef, useState } from 'react'

export function SectionNav({ label, items }: { label: string; items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const nav = rowRef.current?.parentElement
      const line = (nav ? nav.getBoundingClientRect().bottom : 120) + 24
      let current = items[0]?.id
      for (const it of items) {
        const el = document.getElementById(it.id)
        if (el && el.getBoundingClientRect().top <= line) current = it.id
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom) current = items[items.length - 1]?.id
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [items])

  useEffect(() => {
    const row = rowRef.current, pill = row?.querySelector<HTMLElement>(`a[href="#${active}"]`)
    if (row && pill) row.scrollTo({ left: pill.offsetLeft - 16, behavior: 'smooth' })
  }, [active])

  return (
    <nav className="subnav" aria-label={label} data-testid="platform-nav">
      <div className="wrap" ref={rowRef}>
        {items.map(i => (
          <a key={i.id} href={`#${i.id}`} aria-current={active === i.id ? 'true' : undefined}>{i.label}</a>
        ))}
      </div>
    </nav>
  )
}
