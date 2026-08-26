// Fixed palette for category colors — deliberately not a free color picker,
// so every category stays legible/distinct instead of risking illegible or
// clashing custom hex values. Stored as plain hex (not a Tailwind color
// name) so it can be applied via inline style anywhere (card top border,
// filter pill dots) without depending on dynamically-generated Tailwind
// classes, which the build's purge step can't detect.
//
// Capped at 18 — Tailwind's full 500-shade hue set, ordered around the
// color wheel. Past this many categorical swatches, adjacent hues start
// looking too close to reliably tell apart at a glance (worse still for
// colorblind users), so more isn't actually more useful here.
export const CATEGORY_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#EAB308', // yellow
  '#84CC16', // lime
  '#22C55E', // green
  '#10B981', // emerald
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#0EA5E9', // sky
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#D946EF', // fuchsia
  '#EC4899', // pink
  '#F43F5E', // rose
  '#64748B', // slate
  '#78716C', // stone
] as const

export type CategoryColor = typeof CATEGORY_COLORS[number]
