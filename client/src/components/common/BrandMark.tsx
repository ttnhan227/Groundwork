export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-symbol ${className}`.trim()} aria-hidden="true"><img src="/logo.png" alt="" /></span>;
}
