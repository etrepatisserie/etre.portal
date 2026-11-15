import { ICONS } from '../icons.js'

// One Lucide icon. Decorative by default (the text next to it says what it means).
// Pass `label` only for icon-only buttons' inner icon when no aria-label is on the button.
export default function Icon({ name, size = 16, className = '', label, strokeWidth = 1.75 }) {
  const C = name && ICONS[name]
  if (!C) return null
  return <C size={size} strokeWidth={strokeWidth} className={`ic ${className}`} aria-hidden={label ? undefined : true} aria-label={label} focusable="false" />
}
