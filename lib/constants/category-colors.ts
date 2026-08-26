// Fixed palette for category colors — deliberately not a free color picker,
// so every category stays legible/distinct instead of risking illegible or
// clashing custom hex values. Stored as plain hex (not a Tailwind color
// name) so it can be applied via inline style anywhere (card top border,
// filter pill dots) without depending on dynamically-generated Tailwind
// classes, which the build's purge step can't detect.
export const CATEGORY_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#64748B', // slate
] as const

export type CategoryColor = typeof CATEGORY_COLORS[number]
