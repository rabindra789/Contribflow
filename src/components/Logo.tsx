// No external dependencies needed - self-contained SVG component

interface LogoProps {
  width?: number | string;
  height?: number | string;
  alt?: string;
  className?: string;
}

export function Logo({ width = 20, height = 20, alt = 'ContribFlow', className = '' }: LogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={alt}
      className={className}
    >
      <rect width="128" height="128" fill="currentColor" />
      <g fill="currentColor">
        <rect x="16" y="16" width="80" height="16" />
        <rect x="96" y="16" width="16" height="16" />
        <rect x="16" y="32" width="16" height="80" />
        <rect x="16" y="96" width="80" height="16" />
        <rect x="96" y="96" width="16" height="16" />
        <rect x="32" y="16" width="16" height="16" />
        <rect x="16" y="32" width="16" height="16" />
        <rect x="96" y="32" width="16" height="16" />
        <rect x="16" y="80" width="16" height="16" />
        <rect x="96" y="80" width="16" height="16" />
        <rect x="32" y="96" width="16" height="16" />
      </g>
    </svg>
  );
}