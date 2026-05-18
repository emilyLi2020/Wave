// app-icon.jsx — Waves app icon, used wherever the brand mark appears
// (currently: the lock-screen notification badge). Same SVG renders
// crisp at any size; pass `size` in pixels.

function AppIcon({ size = 38, radius }) {
  // iOS continuous-corner square: ~22.37% of the side
  const r = radius != null ? radius : Math.round(size * 0.2237);

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: r,
        overflow: 'hidden',
        // Soft drop-shadow scaled to icon size
        boxShadow: size >= 80
          ? '0 1px 0 rgba(255,255,255,0.6) inset, 0 12px 30px -14px rgba(2,132,199,0.45), 0 2px 6px -2px rgba(11,31,51,0.18)'
          : '0 4px 12px -6px rgba(2,132,199,0.5), 0 1px 3px rgba(11,31,51,0.15)',
        lineHeight: 0,
      }}
    >
      <svg viewBox="0 0 240 240" width={size} height={size}>
        <defs>
          {/* Unique IDs per render so multiple instances don't collide */}
          <linearGradient id={`waves-bg-${size}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.00" stopColor="#fbfeff"/>
            <stop offset="0.25" stopColor="#bce9fc"/>
            <stop offset="0.55" stopColor="#46c3f2"/>
            <stop offset="0.78" stopColor="#0fa3dd"/>
            <stop offset="1.00" stopColor="#0e89c4"/>
          </linearGradient>
          <linearGradient id={`waves-shade-${size}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#06436c" stopOpacity="0.22"/>
            <stop offset="1" stopColor="#06436c" stopOpacity="0.12"/>
          </linearGradient>
          <filter id={`waves-feather-${size}`} x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="0.5"/>
          </filter>
        </defs>

        {/* Continuous gradient ground */}
        <rect width="240" height="240" fill={`url(#waves-bg-${size})`}/>

        {/* Soft depth-tint below the upper wave curve */}
        <path
          d="M -20 104 C 70 49, 170 159, 260 104 L 260 252 L -20 252 Z"
          fill={`url(#waves-shade-${size})`}
          filter={`url(#waves-feather-${size})`}
        />

        {/* Soft depth-tint below the lower wave curve (same shape, +72) */}
        <path
          d="M -20 176 C 70 121, 170 231, 260 176 L 260 252 L -20 252 Z"
          fill={`url(#waves-shade-${size})`}
          filter={`url(#waves-feather-${size})`}
        />

        {/* Hairline crest highlights so the wave silhouettes catch light */}
        <path
          d="M 0 105 C 72 51, 168 158, 240 105"
          fill="none" stroke="#ffffff" strokeWidth="1.7" opacity="0.8"
        />
        <path
          d="M 0 177 C 72 123, 168 230, 240 177"
          fill="none" stroke="#e0f4ff" strokeWidth="1.5" opacity="0.65"
        />
      </svg>
    </span>
  );
}

window.AppIcon = AppIcon;
