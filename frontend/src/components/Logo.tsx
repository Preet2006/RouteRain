/** The RouteRain mark: a raindrop with a route running through it. */
export function Logo({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="RouteRain logo" className="rr-logo">
      <path d="M32 4C32 4 12 26 12 40a20 20 0 0 0 40 0C52 26 32 4 32 4Z" fill="#5ed6ff" />
      <path d="M22 44c6 0 6-10 12-10s5 8 10 8" fill="none" stroke="#06101a" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 6.5" />
      <circle cx="22" cy="44" r="3.6" fill="#06101a" />
      <circle cx="44" cy="42" r="3.6" fill="#fff" stroke="#06101a" strokeWidth="2" />
    </svg>
  );
}
