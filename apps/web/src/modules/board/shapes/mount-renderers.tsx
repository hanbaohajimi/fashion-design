import type { Mount } from "./material-appearance";

interface MountRendererProps {
  readonly mount: Mount;
  readonly shapeWidth: number;
  readonly shapeHeight: number;
}

export function MountRenderer({ mount, shapeWidth, shapeHeight }: MountRendererProps) {
  const x = typeof mount.x === "number" && mount.x < 1
    ? mount.x * shapeWidth
    : mount.x;
  const y = typeof mount.y === "number" && mount.y < 1
    ? mount.y * shapeHeight
    : mount.y;

  switch (mount.variant) {
    case "brass-pin":
      return <BrassPin x={x} y={y} rotation={mount.rotation} />;
    case "red-pin":
      return <RedPin x={x} y={y} rotation={mount.rotation} />;
    case "silver-clip":
      return <SilverClip x={x} y={y} rotation={mount.rotation} />;
    case "masking-tape":
      return <MaskingTape x={x} y={y} rotation={mount.rotation} width={shapeWidth * 0.35} />;
    case "washi-tape":
      return <WashiTape x={x} y={y} rotation={mount.rotation} width={shapeWidth * 0.3} />;
    case "binder-clip":
      return <BinderClip x={x} y={y} rotation={mount.rotation} />;
    default:
      return null;
  }
}

function BrassPin({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Multi-layer shadow for depth */}
      <ellipse
        cx="1.5"
        cy="2.5"
        rx="6"
        ry="5"
        fill="rgb(24 25 21)"
        opacity="0.08"
        filter="blur(3px)"
      />
      <ellipse
        cx="0.8"
        cy="1.5"
        rx="5"
        ry="4"
        fill="rgb(24 25 21)"
        opacity="0.12"
        filter="blur(1.5px)"
      />

      {/* Pin head - brass circle with gradient */}
      <defs>
        <radialGradient id="brass-gradient">
          <stop offset="0%" stopColor="#d9b76a" />
          <stop offset="50%" stopColor="#c9a961" />
          <stop offset="100%" stopColor="#9d8345" />
        </radialGradient>
        <radialGradient id="brass-inner">
          <stop offset="0%" stopColor="#c9a961" />
          <stop offset="100%" stopColor="#b89850" />
        </radialGradient>
      </defs>

      {/* Outer ring with metallic gradient */}
      <circle
        cx="0"
        cy="0"
        r="6"
        fill="url(#brass-gradient)"
        stroke="#8b7539"
        strokeWidth="0.6"
      />

      {/* Inner ring for dimension */}
      <circle
        cx="0"
        cy="0"
        r="4"
        fill="url(#brass-inner)"
        opacity="0.75"
      />

      {/* Brass specular highlight */}
      <ellipse
        cx="-1.8"
        cy="-2"
        rx="2.5"
        ry="1.8"
        fill="rgb(255 252 235)"
        opacity="0.6"
      />

      {/* Secondary highlight */}
      <ellipse
        cx="1.2"
        cy="1.5"
        rx="1.2"
        ry="0.8"
        fill="rgb(255 252 235)"
        opacity="0.25"
      />

      {/* Pin shaft with perspective */}
      <line
        x1="0"
        y1="1"
        x2="0.5"
        y2="5"
        stroke="#8b7539"
        strokeWidth="1.2"
        opacity="0.5"
        strokeLinecap="round"
      />

      {/* Center dot for realism */}
      <circle
        cx="0"
        cy="0"
        r="0.8"
        fill="#7d6833"
        opacity="0.6"
      />
    </g>
  );
}

function RedPin({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Enhanced shadow for signal emphasis */}
      <ellipse
        cx="1.5"
        cy="2.5"
        rx="6.5"
        ry="5.5"
        fill="rgb(157 47 32)"
        opacity="0.15"
        filter="blur(3px)"
      />
      <ellipse
        cx="0.8"
        cy="1.5"
        rx="5.5"
        ry="4.5"
        fill="rgb(157 47 32)"
        opacity="0.18"
        filter="blur(1.5px)"
      />

      <defs>
        <radialGradient id="red-gradient">
          <stop offset="0%" stopColor="#e84232" />
          <stop offset="50%" stopColor="#d63020" />
          <stop offset="100%" stopColor="#a52c1f" />
        </radialGradient>
        <radialGradient id="red-inner">
          <stop offset="0%" stopColor="#d63020" />
          <stop offset="100%" stopColor="#b82818" />
        </radialGradient>
      </defs>

      {/* Outer ring - vibrant red */}
      <circle
        cx="0"
        cy="0"
        r="6"
        fill="url(#red-gradient)"
        stroke="#8b2618"
        strokeWidth="0.7"
      />

      {/* Glow effect for avoid signal */}
      <circle
        cx="0"
        cy="0"
        r="7.5"
        fill="none"
        stroke="#e84232"
        strokeWidth="1.5"
        opacity="0.15"
      />

      {/* Inner ring */}
      <circle
        cx="0"
        cy="0"
        r="4"
        fill="url(#red-inner)"
        opacity="0.8"
      />

      {/* Red specular highlight */}
      <ellipse
        cx="-1.8"
        cy="-2"
        rx="2.5"
        ry="1.8"
        fill="rgb(255 220 220)"
        opacity="0.5"
      />

      {/* Secondary highlight */}
      <ellipse
        cx="1.2"
        cy="1.5"
        rx="1.2"
        ry="0.8"
        fill="rgb(255 200 200)"
        opacity="0.3"
      />

      {/* Pin shaft */}
      <line
        x1="0"
        y1="1"
        x2="0.5"
        y2="5"
        stroke="#8b2618"
        strokeWidth="1.2"
        opacity="0.6"
        strokeLinecap="round"
      />

      {/* Center dot */}
      <circle
        cx="0"
        cy="0"
        r="0.8"
        fill="#7d1f14"
        opacity="0.7"
      />
    </g>
  );
}

function SilverClip({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Enhanced shadow with contact and ambient layers */}
      <rect
        x="1.5"
        y="2.5"
        width="18"
        height="32"
        rx="2"
        fill="rgb(24 25 21)"
        opacity="0.12"
        filter="blur(4px)"
      />
      <rect
        x="0.5"
        y="1"
        width="18"
        height="32"
        rx="2"
        fill="rgb(24 25 21)"
        opacity="0.15"
        filter="blur(1.5px)"
      />

      <defs>
        <linearGradient id="clip-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9ea2aa" />
          <stop offset="40%" stopColor="#c8ccd4" />
          <stop offset="60%" stopColor="#b8bcc4" />
          <stop offset="100%" stopColor="#8a8e96" />
        </linearGradient>
        <linearGradient id="clip-shine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity="0.6" />
          <stop offset="50%" stopColor="rgb(255 255 255)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(255 255 255)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Clip body with metallic gradient */}
      <rect
        x="0"
        y="0"
        width="18"
        height="32"
        rx="2.5"
        fill="url(#clip-gradient)"
        stroke="#6e7178"
        strokeWidth="0.6"
      />

      {/* Chrome specular highlight */}
      <rect
        x="1.5"
        y="1.5"
        width="15"
        height="14"
        rx="1.5"
        fill="url(#clip-shine)"
      />

      {/* Vertical highlight edge */}
      <rect
        x="13"
        y="4"
        width="2"
        height="24"
        fill="rgb(255 255 255)"
        opacity="0.35"
        rx="0.5"
      />

      {/* Clip wire mechanism */}
      <line
        x1="9"
        y1="8"
        x2="9"
        y2="24"
        stroke="#5a5e66"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Wire loop */}
      <circle
        cx="9"
        cy="16"
        r="3.5"
        fill="none"
        stroke="#5a5e66"
        strokeWidth="1.2"
      />

      {/* Inner highlight on wire */}
      <circle
        cx="9"
        cy="16"
        r="3.5"
        fill="none"
        stroke="rgb(255 255 255)"
        strokeWidth="0.4"
        opacity="0.3"
        strokeDasharray="3,2"
      />

      {/* Metal grip texture */}
      <line
        x1="3"
        y1="4"
        x2="3"
        y2="28"
        stroke="#8a8e96"
        strokeWidth="0.3"
        opacity="0.5"
      />
      <line
        x1="15"
        y1="4"
        x2="15"
        y2="28"
        stroke="#8a8e96"
        strokeWidth="0.3"
        opacity="0.5"
      />

      {/* Bottom edge shadow */}
      <rect
        x="1"
        y="28"
        width="16"
        height="3"
        fill="rgb(24 25 21)"
        opacity="0.15"
        rx="1"
      />
    </g>
  );
}

function MaskingTape({
  x,
  y,
  rotation,
  width
}: {
  x: number;
  y: number;
  rotation: number;
  width: number;
}) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Multi-layer shadow for lifted tape */}
      <rect
        x={-width / 2 + 1.5}
        y="2.5"
        width={width}
        height="22"
        rx="1"
        fill="rgb(24 25 21)"
        opacity="0.08"
        filter="blur(3px)"
      />
      <rect
        x={-width / 2 + 0.5}
        y="1.5"
        width={width}
        height="22"
        rx="1"
        fill="rgb(24 25 21)"
        opacity="0.1"
        filter="blur(1.5px)"
      />

      <defs>
        <linearGradient id="tape-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f2e6d4" />
          <stop offset="50%" stopColor="#e8dcc8" />
          <stop offset="100%" stopColor="#ddd1bd" />
        </linearGradient>

        {/* Tape texture pattern */}
        <pattern id="tape-texture" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="rgb(24 25 21)" opacity="0.02" />
        </pattern>
      </defs>

      {/* Tape body with gradient and semi-transparency */}
      <rect
        x={-width / 2}
        y="0"
        width={width}
        height="22"
        rx="1"
        fill="url(#tape-gradient)"
        opacity="0.88"
        stroke="rgb(24 25 21)"
        strokeWidth="0.5"
        strokeOpacity="0.15"
      />

      {/* Texture overlay */}
      <rect
        x={-width / 2}
        y="0"
        width={width}
        height="22"
        rx="1"
        fill="url(#tape-texture)"
      />

      {/* Edge fibers/raggedness */}
      <line
        x1={-width / 2}
        y1="2"
        x2={-width / 2}
        y2="20"
        stroke="rgb(24 25 21)"
        strokeWidth="0.3"
        opacity="0.12"
        strokeDasharray="1,2"
      />
      <line
        x1={width / 2}
        y1="2"
        x2={width / 2}
        y2="20"
        stroke="rgb(24 25 21)"
        strokeWidth="0.3"
        opacity="0.12"
        strokeDasharray="1,2"
      />

      {/* Adhesive shine at top */}
      <rect
        x={-width / 2 + 2}
        y="2"
        width={width - 4}
        height="7"
        rx="0.5"
        fill="rgb(255 255 255)"
        opacity="0.25"
      />

      {/* Subtle creases */}
      <line
        x1={-width / 2 + width * 0.3}
        y1="0"
        x2={-width / 2 + width * 0.32}
        y2="22"
        stroke="rgb(24 25 21)"
        strokeWidth="0.4"
        opacity="0.08"
      />
      <line
        x1={-width / 2 + width * 0.7}
        y1="0"
        x2={-width / 2 + width * 0.68}
        y2="22"
        stroke="rgb(24 25 21)"
        strokeWidth="0.4"
        opacity="0.08"
      />

      {/* Air bubbles under tape */}
      <ellipse
        cx={-width / 2 + width * 0.4}
        cy="12"
        rx="3"
        ry="2"
        fill="rgb(255 255 255)"
        opacity="0.15"
      />
      <ellipse
        cx={-width / 2 + width * 0.75}
        cy="8"
        rx="2.5"
        ry="1.8"
        fill="rgb(255 255 255)"
        opacity="0.12"
      />
    </g>
  );
}

function WashiTape({
  x,
  y,
  rotation,
  width
}: {
  x: number;
  y: number;
  rotation: number;
  width: number;
}) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Multi-layer shadow for decorative tape */}
      <rect
        x={-width / 2 + 1.5}
        y="2.5"
        width={width}
        height="18"
        rx="0.5"
        fill="rgb(24 25 21)"
        opacity="0.08"
        filter="blur(3px)"
      />
      <rect
        x={-width / 2 + 0.5}
        y="1.5"
        width={width}
        height="18"
        rx="0.5"
        fill="rgb(24 25 21)"
        opacity="0.1"
        filter="blur(1.5px)"
      />

      <defs>
        <linearGradient id="washi-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e0d4bb" />
          <stop offset="50%" stopColor="#d4c5a9" />
          <stop offset="100%" stopColor="#c8b898" />
        </linearGradient>

        {/* Fine texture pattern for washi paper */}
        <pattern id="washi-texture" x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="rgb(24 25 21)" opacity="0.025" />
        </pattern>
      </defs>

      {/* Washi tape body with gradient and semi-transparency */}
      <rect
        x={-width / 2}
        y="0"
        width={width}
        height="18"
        rx="0.5"
        fill="url(#washi-gradient)"
        opacity="0.82"
        stroke="rgb(24 25 21)"
        strokeWidth="0.4"
        strokeOpacity="0.12"
      />

      {/* Texture overlay */}
      <rect
        x={-width / 2}
        y="0"
        width={width}
        height="18"
        rx="0.5"
        fill="url(#washi-texture)"
      />

      {/* Decorative dots pattern with enhanced depth */}
      <g opacity="0.5">
        {Array.from({ length: Math.floor(width / 12) }).map((_, i) => (
          <g key={i}>
            <circle
              cx={-width / 2 + 6 + i * 12}
              cy="6"
              r="1.5"
              fill="#8a7d65"
            />
            <circle
              cx={-width / 2 + 6 + i * 12}
              cy="6"
              r="0.8"
              fill="rgb(255 255 255)"
              opacity="0.2"
            />
          </g>
        ))}
        {Array.from({ length: Math.floor(width / 12) }).map((_, i) => (
          <g key={`b-${i}`}>
            <circle
              cx={-width / 2 + 6 + i * 12}
              cy="12"
              r="1.5"
              fill="#8a7d65"
            />
            <circle
              cx={-width / 2 + 6 + i * 12}
              cy="12"
              r="0.8"
              fill="rgb(255 255 255)"
              opacity="0.2"
            />
          </g>
        ))}
      </g>

      {/* Adhesive shine at top edge */}
      <rect
        x={-width / 2 + 1.5}
        y="1.5"
        width={width - 3}
        height="5"
        rx="0.3"
        fill="rgb(255 255 255)"
        opacity="0.3"
      />

      {/* Subtle edge wear */}
      <line
        x1={-width / 2}
        y1="3"
        x2={-width / 2}
        y2="15"
        stroke="rgb(24 25 21)"
        strokeWidth="0.25"
        opacity="0.1"
      />
      <line
        x1={width / 2}
        y1="3"
        x2={width / 2}
        y2="15"
        stroke="rgb(24 25 21)"
        strokeWidth="0.25"
        opacity="0.1"
      />
    </g>
  );
}

function BinderClip({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Multi-layer shadow for metal clip */}
      <rect
        x="1.5"
        y="2.5"
        width="24"
        height="12"
        rx="1"
        fill="rgb(24 25 21)"
        opacity="0.18"
        filter="blur(3.5px)"
      />
      <rect
        x="0.5"
        y="1.5"
        width="24"
        height="12"
        rx="1"
        fill="rgb(24 25 21)"
        opacity="0.2"
        filter="blur(1.5px)"
      />

      <defs>
        <linearGradient id="clip-body-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2f3239" />
          <stop offset="50%" stopColor="#2a2d33" />
          <stop offset="100%" stopColor="#22252a" />
        </linearGradient>
        <linearGradient id="handle-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3a3d43" />
          <stop offset="50%" stopColor="#444850" />
          <stop offset="100%" stopColor="#3a3d43" />
        </linearGradient>
      </defs>

      {/* Clip body - black metal with gradient */}
      <rect
        x="0"
        y="0"
        width="24"
        height="12"
        rx="1.5"
        fill="url(#clip-body-gradient)"
        stroke="#1a1c20"
        strokeWidth="0.6"
      />

      {/* Metal texture lines */}
      <line
        x1="4"
        y1="3"
        x2="4"
        y2="9"
        stroke="#1a1c20"
        strokeWidth="0.3"
        opacity="0.5"
      />
      <line
        x1="20"
        y1="3"
        x2="20"
        y2="9"
        stroke="#1a1c20"
        strokeWidth="0.3"
        opacity="0.5"
      />

      {/* Enhanced metal handles with gradient */}
      <path
        d="M 6 6 L 3 1 L 3 11 L 6 6 Z"
        fill="url(#handle-gradient)"
        stroke="#2a2d33"
        strokeWidth="0.6"
      />
      <path
        d="M 18 6 L 21 1 L 21 11 L 18 6 Z"
        fill="url(#handle-gradient)"
        stroke="#2a2d33"
        strokeWidth="0.6"
      />

      {/* Handle highlights */}
      <path
        d="M 4.5 4 L 4 2.5 L 4.5 5.5"
        stroke="rgb(255 255 255)"
        strokeWidth="0.5"
        opacity="0.2"
        strokeLinecap="round"
      />
      <path
        d="M 19.5 4 L 20 2.5 L 19.5 5.5"
        stroke="rgb(255 255 255)"
        strokeWidth="0.5"
        opacity="0.2"
        strokeLinecap="round"
      />

      {/* Top shine with gradient falloff */}
      <rect
        x="7"
        y="2.5"
        width="10"
        height="3.5"
        rx="0.5"
        fill="rgb(255 255 255)"
        opacity="0.18"
      />

      {/* Specular highlight */}
      <ellipse
        cx="12"
        cy="4"
        rx="4"
        ry="1.5"
        fill="rgb(255 255 255)"
        opacity="0.25"
      />

      {/* Bottom edge shadow for depth */}
      <rect
        x="1"
        y="10"
        width="22"
        height="1.5"
        fill="rgb(24 25 21)"
        opacity="0.2"
        rx="0.5"
      />
    </g>
  );
}
