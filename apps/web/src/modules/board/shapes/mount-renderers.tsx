import type { Mount } from "./material-appearance";

interface MountRendererProps {
  readonly mount: Mount;
  /** Unscaled shape width used to derive each tape variant's natural width. */
  readonly referenceShapeWidth: number;
}

/**
 * Renders a single mount fastener at mount.x, mount.y (absolute pixel coords).
 * All gradient / filter IDs are namespaced with mount.id to avoid SVG ID collisions
 * when multiple mounts of the same variant appear on the same page.
 */
export function MountRenderer({ mount, referenceShapeWidth }: MountRendererProps) {
  const { x, y, rotation, variant, id } = mount;

  switch (variant) {
    case "brass-pin":
      return <BrassPin x={x} y={y} rotation={rotation} id={id} />;
    case "red-pin":
      return <RedPin x={x} y={y} rotation={rotation} id={id} />;
    case "silver-clip":
      return <SilverClip x={x} y={y} rotation={rotation} id={id} />;
    case "masking-tape":
      return (
        <MaskingTape
          x={x}
          y={y}
          rotation={rotation}
          id={id}
          width={Math.max(64, referenceShapeWidth * 0.35)}
        />
      );
    case "washi-tape":
      return (
        <WashiTape
          x={x}
          y={y}
          rotation={rotation}
          id={id}
          width={Math.max(56, referenceShapeWidth * 0.3)}
        />
      );
    case "binder-clip":
      return <BinderClip x={x} y={y} rotation={rotation} id={id} />;
    default:
      return null;
  }
}

function pinHash(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return h;
}

function BrassPin({ x, y, rotation, id: mountId }: {
  x: number; y: number; rotation: number; id: string;
}) {
  const h = pinHash(mountId);
  const sx  = 0.974 + (h & 0xF) * 0.0035;
  const sy  = 0.935 + ((h >> 4) & 0xF) * 0.0035;
  const hlx = ((h >> 8) & 3) - 1;
  const hly = ((h >> 12) & 3) - 1;
  const gid = `bp-${mountId}`;
  const r = 7;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <defs>
        <radialGradient id={gid} cx="36%" cy="32%" r="68%">
          <stop offset="0%"   stopColor="#A88A43" />
          <stop offset="35%"  stopColor="#8B6C27" />
          <stop offset="70%"  stopColor="#756331" />
          <stop offset="100%" stopColor="#5F4B20" />
        </radialGradient>
      </defs>

      {/* Press-in dent shadow on the paper surface */}
      <ellipse
        cx="0" cy={r + 2}
        rx="7" ry="3"
        fill="rgba(45,37,24,0.10)"
        style={{ filter: "blur(2px)" }}
      />

      {/* Contact shadow */}
      <ellipse
        cx="0.8" cy="1.5"
        rx={r * 0.9} ry={r * 0.7}
        fill="rgba(45,37,24,0.18)"
        style={{ filter: "blur(3px)" }}
      />

      {/* Pin cap */}
      <ellipse cx="0" cy="0" rx={r * sx} ry={r * sy} fill={`url(#${gid})`} />

      {/* Bottom contact darkening */}
      <ellipse
        cx="0" cy={r * sy * 0.65}
        rx={r * sx * 0.70} ry={r * sy * 0.34}
        fill="rgba(45,37,24,0.14)"
      />

      {/* Diffuse highlight */}
      <ellipse
        cx={-r * 0.28 + hlx} cy={-r * 0.32 + hly}
        rx={r * 0.26} ry={r * 0.18}
        fill="rgba(222,204,145,0.45)"
      />

      {/* Rim */}
      <ellipse
        cx="0" cy="0" rx={r * sx} ry={r * sy}
        fill="none" stroke="#5F4B20" strokeWidth="0.5" opacity="0.22"
      />

      {/* Shaft */}
      <line
        x1="0.3" y1={r * sy * 0.5}
        x2="0.5" y2={r + 3.5}
        stroke="#5F4B20" strokeWidth="1.2" strokeLinecap="round" opacity="0.38"
      />

      {/* Center dimple */}
      <circle cx="0" cy="0" r="1" fill="#5F4B20" opacity="0.32" />
    </g>
  );
}

function RedPin({ x, y, rotation, id: mountId }: {
  x: number; y: number; rotation: number; id: string;
}) {
  const h = pinHash(mountId);
  const sx  = 0.974 + (h & 0xF) * 0.0035;
  const sy  = 0.935 + ((h >> 4) & 0xF) * 0.0035;
  const hlx = ((h >> 8) & 3) - 1;
  const hly = ((h >> 12) & 3) - 1;
  const gid = `rp-${mountId}`;
  const r = 7;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <defs>
        <radialGradient id={gid} cx="36%" cy="32%" r="68%">
          <stop offset="0%"   stopColor="#A34B3F" />
          <stop offset="52%"  stopColor="#8A3A30" />
          <stop offset="100%" stopColor="#5C2820" />
        </radialGradient>
      </defs>

      {/* Press-in dent */}
      <ellipse
        cx="0" cy={r + 2}
        rx="7" ry="3"
        fill="rgba(45,37,24,0.10)"
        style={{ filter: "blur(2px)" }}
      />

      {/* Contact shadow */}
      <ellipse
        cx="0.8" cy="1.5"
        rx={r * 0.9} ry={r * 0.7}
        fill="rgba(45,37,24,0.18)"
        style={{ filter: "blur(3px)" }}
      />

      {/* Pin cap */}
      <ellipse cx="0" cy="0" rx={r * sx} ry={r * sy} fill={`url(#${gid})`} />

      {/* Bottom contact darkening */}
      <ellipse
        cx="0" cy={r * sy * 0.65}
        rx={r * sx * 0.70} ry={r * sy * 0.34}
        fill="rgba(45,37,24,0.14)"
      />

      {/* Highlight */}
      <ellipse
        cx={-r * 0.28 + hlx} cy={-r * 0.32 + hly}
        rx={r * 0.23} ry={r * 0.16}
        fill="rgba(210,160,145,0.38)"
      />

      {/* Rim */}
      <ellipse
        cx="0" cy="0" rx={r * sx} ry={r * sy}
        fill="none" stroke="#5C2820" strokeWidth="0.5" opacity="0.22"
      />

      {/* Shaft */}
      <line
        x1="0.3" y1={r * sy * 0.5}
        x2="0.5" y2={r + 3.5}
        stroke="#5C2820" strokeWidth="1.2" strokeLinecap="round" opacity="0.38"
      />

      <circle cx="0" cy="0" r="1" fill="#5C2820" opacity="0.36" />
    </g>
  );
}

function SilverClip({ x, y, rotation, id: mountId }: {
  x: number; y: number; rotation: number; id: string;
}) {
  const g1 = `sc-a-${mountId}`;
  const g2 = `sc-b-${mountId}`;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <rect x="2" y="3.5" width="22" height="38" rx="2.5"
        fill="rgb(24 25 21)" opacity="0.18" style={{ filter: "blur(5px)" }} />
      <rect x="1" y="1.5" width="22" height="38" rx="2.5"
        fill="rgb(24 25 21)" opacity="0.22" style={{ filter: "blur(2px)" }} />

      <defs>
        <linearGradient id={g1} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#a5a9b1" />
          <stop offset="40%"  stopColor="#d4d8e0" />
          <stop offset="60%"  stopColor="#c4c8d0" />
          <stop offset="100%" stopColor="#96999f" />
        </linearGradient>
        <linearGradient id={g2} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="rgb(255 255 255)" stopOpacity="0.7" />
          <stop offset="50%"  stopColor="rgb(255 255 255)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="rgb(255 255 255)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="22" height="38" rx="3"
        fill={`url(#${g1})`} stroke="#6e7178" strokeWidth="0.8" />
      <rect x="2" y="2" width="18" height="16" rx="2" fill={`url(#${g2})`} />
      <rect x="16" y="5" width="2.5" height="28" fill="rgb(255 255 255)" opacity="0.45" rx="0.8" />
      <line x1="11" y1="10" x2="11" y2="28" stroke="#5a5e66" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="19" r="4.5" fill="none" stroke="#5a5e66" strokeWidth="1.5" />
      <circle cx="11" cy="19" r="4.5" fill="none" stroke="rgb(255 255 255)"
        strokeWidth="0.5" opacity="0.4" strokeDasharray="4,2.5" />
      <line x1="4" y1="5" x2="4" y2="33" stroke="#8a8e96" strokeWidth="0.4" opacity="0.6" />
      <line x1="18" y1="5" x2="18" y2="33" stroke="#8a8e96" strokeWidth="0.4" opacity="0.6" />
      <rect x="1.5" y="33" width="19" height="4" fill="rgb(24 25 21)" opacity="0.25" rx="1.5" />
    </g>
  );
}

function MaskingTape({ x, y, rotation, id: mountId, width }: {
  x: number; y: number; rotation: number; id: string; width: number;
}) {
  const g1 = `mt-a-${mountId}`;
  const g2 = `mt-b-${mountId}`;
  const p1 = `mt-p-${mountId}`;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <rect x={-width / 2 + 2} y="3.5" width={width} height="26" rx="1.5"
        fill="rgb(24 25 21)" opacity="0.12" style={{ filter: "blur(4px)" }} />
      <rect x={-width / 2 + 1} y="2" width={width} height="26" rx="1.5"
        fill="rgb(24 25 21)" opacity="0.15" style={{ filter: "blur(2px)" }} />

      <defs>
        <linearGradient id={g1} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#f5ead8" />
          <stop offset="50%"  stopColor="#ebe0cc" />
          <stop offset="100%" stopColor="#dfd4c0" />
        </linearGradient>
        <pattern id={p1} x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="rgb(24 25 21)" opacity="0.03" />
        </pattern>
        <linearGradient id={g2} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="88%" stopColor="rgb(24 25 21)" stopOpacity="0" />
          <stop offset="100%" stopColor="rgb(24 25 21)" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      <rect x={-width / 2} y="0" width={width} height="26" rx="1.5"
        fill={`url(#${g1})`} opacity="0.9" stroke="rgb(24 25 21)" strokeWidth="0.6" strokeOpacity="0.2" />
      <rect x={-width / 2} y="0" width={width} height="26" rx="1.5" fill={`url(#${p1})`} />
      <line x1={-width / 2} y1="3" x2={-width / 2} y2="23"
        stroke="rgb(24 25 21)" strokeWidth="0.4" opacity="0.18" strokeDasharray="1.5,2.5" />
      <line x1={width / 2} y1="3" x2={width / 2} y2="23"
        stroke="rgb(24 25 21)" strokeWidth="0.4" opacity="0.18" strokeDasharray="1.5,2.5" />
      <rect x={-width / 2 + 3} y="3" width={width - 6} height="8" rx="1"
        fill="rgb(255 255 255)" opacity="0.35" />
      <line x1={-width / 2 + width * 0.3} y1="0" x2={-width / 2 + width * 0.32} y2="26"
        stroke="rgb(24 25 21)" strokeWidth="0.5" opacity="0.12" />
      <line x1={-width / 2 + width * 0.7} y1="0" x2={-width / 2 + width * 0.68} y2="26"
        stroke="rgb(24 25 21)" strokeWidth="0.5" opacity="0.12" />
      <path
        d={`M ${width / 2 - 15} 0 L ${width / 2} 0 L ${width / 2} 12 L ${width / 2 - 8} 8 Z`}
        fill={`url(#${g2})`}
      />
    </g>
  );
}

function WashiTape({ x, y, rotation, id: mountId, width }: {
  x: number; y: number; rotation: number; id: string; width: number;
}) {
  const g1 = `wt-a-${mountId}`;
  const p1 = `wt-p-${mountId}`;
  const dotCount = Math.max(2, Math.floor(width / 12));

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <rect x={-width / 2 + 1.5} y="2.5" width={width} height="18" rx="0.5"
        fill="rgb(24 25 21)" opacity="0.08" style={{ filter: "blur(3px)" }} />
      <rect x={-width / 2 + 0.5} y="1.5" width={width} height="18" rx="0.5"
        fill="rgb(24 25 21)" opacity="0.1" style={{ filter: "blur(1.5px)" }} />

      <defs>
        <linearGradient id={g1} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#e0d4bb" />
          <stop offset="50%"  stopColor="#d4c5a9" />
          <stop offset="100%" stopColor="#c8b898" />
        </linearGradient>
        <pattern id={p1} x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="rgb(24 25 21)" opacity="0.025" />
        </pattern>
      </defs>

      <rect x={-width / 2} y="0" width={width} height="18" rx="0.5"
        fill={`url(#${g1})`} opacity="0.82" stroke="rgb(24 25 21)" strokeWidth="0.4" strokeOpacity="0.12" />
      <rect x={-width / 2} y="0" width={width} height="18" rx="0.5" fill={`url(#${p1})`} />

      {/* Dot pattern */}
      <g opacity="0.5">
        {Array.from({ length: dotCount }).map((_, i) => (
          <g key={i}>
            <circle cx={-width / 2 + 6 + i * 12} cy="6"  r="1.5" fill="#8a7d65" />
            <circle cx={-width / 2 + 6 + i * 12} cy="6"  r="0.8" fill="rgb(255 255 255)" opacity="0.2" />
            <circle cx={-width / 2 + 6 + i * 12} cy="12" r="1.5" fill="#8a7d65" />
            <circle cx={-width / 2 + 6 + i * 12} cy="12" r="0.8" fill="rgb(255 255 255)" opacity="0.2" />
          </g>
        ))}
      </g>

      <rect x={-width / 2 + 1.5} y="1.5" width={width - 3} height="5" rx="0.3"
        fill="rgb(255 255 255)" opacity="0.3" />
    </g>
  );
}

function BinderClip({ x, y, rotation, id: mountId }: {
  x: number; y: number; rotation: number; id: string;
}) {
  const g1 = `bc-body-${mountId}`;
  const g2 = `bc-handle-${mountId}`;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <rect x="1.5" y="2.5" width="24" height="12" rx="1"
        fill="rgb(24 25 21)" opacity="0.18" style={{ filter: "blur(3.5px)" }} />
      <rect x="0.5" y="1.5" width="24" height="12" rx="1"
        fill="rgb(24 25 21)" opacity="0.2" style={{ filter: "blur(1.5px)" }} />

      <defs>
        <linearGradient id={g1} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#2f3239" />
          <stop offset="50%"  stopColor="#2a2d33" />
          <stop offset="100%" stopColor="#22252a" />
        </linearGradient>
        <linearGradient id={g2} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#3a3d43" />
          <stop offset="50%"  stopColor="#444850" />
          <stop offset="100%" stopColor="#3a3d43" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="24" height="12" rx="1.5"
        fill={`url(#${g1})`} stroke="#1a1c20" strokeWidth="0.6" />
      <line x1="4" y1="3" x2="4" y2="9" stroke="#1a1c20" strokeWidth="0.3" opacity="0.5" />
      <line x1="20" y1="3" x2="20" y2="9" stroke="#1a1c20" strokeWidth="0.3" opacity="0.5" />
      <path d="M 6 6 L 3 1 L 3 11 L 6 6 Z" fill={`url(#${g2})`} stroke="#2a2d33" strokeWidth="0.6" />
      <path d="M 18 6 L 21 1 L 21 11 L 18 6 Z" fill={`url(#${g2})`} stroke="#2a2d33" strokeWidth="0.6" />
      <rect x="7" y="2.5" width="10" height="3.5" rx="0.5" fill="rgb(255 255 255)" opacity="0.18" />
      <ellipse cx="12" cy="4" rx="4" ry="1.5" fill="rgb(255 255 255)" opacity="0.25" />
    </g>
  );
}
