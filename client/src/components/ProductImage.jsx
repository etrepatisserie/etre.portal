// Product photo, or a soft ivory/gold placeholder with the product's initials until a real photo is uploaded
export default function ProductImage({ src, name = '', className = '' }) {
  if (src) return <img className={`product-img ${className}`} src={src} alt={name} loading="lazy" />
  const initials = name.replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  return (
    <div className={`product-img placeholder ${className}`} role="img" aria-label={`${name} (photo coming soon)`}>
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <rect width="120" height="90" fill="#faf6ee" />
        <circle cx="60" cy="42" r="22" fill="none" stroke="#d8c39c" strokeWidth="1" />
        <circle cx="60" cy="42" r="18.5" fill="none" stroke="#e9dcc3" strokeWidth="0.6" />
        <text x="60" y="47.5" textAnchor="middle" fontFamily="Georgia, serif" fontSize="15" fill="#a8875a" letterSpacing="1">{initials}</text>
        <text x="60" y="80" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6.5" fill="#b8a585" letterSpacing="2">PHOTO COMING SOON</text>
      </svg>
    </div>
  )
}
