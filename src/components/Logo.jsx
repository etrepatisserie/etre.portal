// Être Patisserie mark + wordmark. Placeholder artwork until the official logo file is supplied:
// drop it in public/logo.svg and swap the <span className="logo-mark"> for <img src="/logo.svg" alt="" />.
export default function Logo({ sub, compact = false }) {
  return (
    <span className="logo">
      <span className="logo-mark" aria-hidden="true">Ê</span>
      {!compact && <span className="logo-text"><span className="logo-name">Être Patisserie</span>{sub && <span className="logo-sub">{sub}</span>}</span>}
    </span>
  )
}
