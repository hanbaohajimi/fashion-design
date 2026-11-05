"use client";

import { useId } from "react";
import type { WardrobeRevisionView } from "@fashion/shared";
import styles from "./rack-hardware.module.css";

type Display = WardrobeRevisionView["display"];

/** Coordinates are in SVG units; multiply by rendered width / 140. */
export const RACK_HARDWARE_METRICS = {
  viewBox: { x: 0, y: -8, width: 140, height: 84 },
  rail: { x: 70, y: 0 },
  hookTop: -6,
  anchors: {
    hanger: { x: 70, y: 26 },
    clips: { x: 70, y: 48 },
    hook: { x: 80, y: 44 },
    shelf: { x: 70, y: 48 },
  } satisfies Record<Display, { x: number; y: number }>,
} as const;

const SHOULDER = "M8 46C21 38 42 28 57 22L61 17Q70 13 79 17L83 22C98 28 119 38 132 46Q137 49 132 53L127 55C108 48 87 39 74 33Q70 31 66 33C53 39 32 48 13 55L8 53Q3 50 8 46Z";
const RAIL_HOOK = "M62 7C60 1 63-4.5 69-4.5C76-4.5 79 1 76 6C74 10 70 11 70 15V21";

/** Decorative, independently positioned hardware; never part of the garment asset. */
export function RackHardware({ display, width = 140, shelfDepth = 18 }: { display: Display; width?: number; shelfDepth?: number }) {
  const id = `rack-hardware-${useId().replace(/:/g, "")}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  // A single rearward plane; the front edge and garment anchor never move as depth changes.
  const shelfBack = 48 - Math.max(140 * .08, Math.min(140 * .5, shelfDepth));
  const shelfSurface = `M17 ${shelfBack}H123L135 48H5Z`;
  return (
    <svg
      className={styles.hardware}
      data-rack-hardware={display}
      viewBox="0 -8 140 84"
      width={width}
      height={width * 84 / 140}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-walnut`} x1="34" y1="18" x2="85" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#95674b" />
          <stop offset=".16" stopColor="#70462e" />
          <stop offset=".43" stopColor="#543020" />
          <stop offset=".65" stopColor="#75472d" />
          <stop offset=".83" stopColor="#633922" />
          <stop offset="1" stopColor="#3b2118" />
        </linearGradient>
        <linearGradient id={`${id}-wood-edge`} x1="10" y1="48" x2="129" y2="55" gradientUnits="userSpaceOnUse">
          <stop stopColor="#593521" />
          <stop offset=".38" stopColor="#2e1a13" />
          <stop offset=".65" stopColor="#4a2a1b" />
          <stop offset="1" stopColor="#241710" />
        </linearGradient>
        <linearGradient id={`${id}-wood-light`} x1="30" y1="22" x2="113" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e4ba86" stopOpacity=".62" />
          <stop offset=".45" stopColor="#c8915c" stopOpacity=".32" />
          <stop offset="1" stopColor="#d6a16b" stopOpacity=".08" />
        </linearGradient>
        <linearGradient id={`${id}-metal`} x1="60" y1="0" x2="77" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#686c6a" />
          <stop offset=".16" stopColor="#e7e9e5" />
          <stop offset=".28" stopColor="#fcfdf8" />
          <stop offset=".43" stopColor="#8a8d88" />
          <stop offset=".59" stopColor="#c5c8c1" />
          <stop offset=".72" stopColor="#f5f6ef" />
          <stop offset=".87" stopColor="#777d77" />
          <stop offset="1" stopColor="#454d47" />
        </linearGradient>
        <linearGradient id={`${id}-steel-face`} x1="0" y1="0" x2="1" y2=".14">
          <stop stopColor="#777d78" />
          <stop offset=".13" stopColor="#d4d8d1" />
          <stop offset=".27" stopColor="#f7f8f1" />
          <stop offset=".43" stopColor="#a0a79f" />
          <stop offset=".67" stopColor="#e0e4dc" />
          <stop offset=".85" stopColor="#9a9f99" />
          <stop offset="1" stopColor="#545e56" />
        </linearGradient>
        <linearGradient id={`${id}-steel-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#626d64" />
          <stop offset=".18" stopColor="#d4dad0" />
          <stop offset=".39" stopColor="#f8faf2" />
          <stop offset=".52" stopColor="#bec7bc" />
          <stop offset=".76" stopColor="#687469" />
          <stop offset="1" stopColor="#414d43" />
        </linearGradient>
        <pattern id={`${id}-grain`} width="54" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-17)">
          <path d="M-8 2C4-1 15 5 30 2S49 3 63 0M-8 8C6 5 15 10 29 7S48 9 63 6M-8 14C8 11 18 16 33 13S50 15 63 12" stroke="#24130d" strokeOpacity=".22" strokeWidth=".55" />
          <path d="M-8 4C9 0 17 7 33 4S51 6 63 3M-8 11C5 7 17 13 32 10S50 12 63 9" stroke="#c79460" strokeOpacity=".22" strokeWidth=".4" />
          <path d="M19 1C22 3 28 3 31 1M34 13C38 11 44 12 47 14" stroke="#301a10" strokeOpacity=".24" strokeWidth=".4" />
        </pattern>
        <clipPath id={`${id}-shoulder-clip`}><path d={SHOULDER} /></clipPath>
        <clipPath id={`${id}-tray-clip`}><path d={shelfSurface} /></clipPath>
      </defs>

      {display !== "shelf" ? (
        <g strokeLinecap="round" strokeLinejoin="round">
          <path d={RAIL_HOOK} stroke="#5c635d" strokeWidth="3.1" />
          <path d={RAIL_HOOK} stroke={paint("metal")} strokeWidth="2.5" />
          <path d="M62.3 6C61.1 1 64-3.4 69-3.4C73.1-3.4 76.1-.5 76.2 2" stroke="#fafbf4" strokeOpacity=".85" strokeWidth=".65" />
          <path d="M70 12V20" stroke="#f3f6eb" strokeOpacity=".72" strokeWidth=".65" />
        </g>
      ) : null}

      {display === "hanger" ? (
        <g className={styles.woodenShoulder}>
          <path d={SHOULDER} transform="translate(0 2.6)" fill={paint("wood-edge")} />
          <path d={SHOULDER} fill={paint("walnut")} />
          <g clipPath={paint("shoulder-clip")}>
            <path d={SHOULDER} fill={paint("grain")} />
            <path d="M4 48C25 36 45 30 60 22Q69 16 79 22C97 31 115 37 136 49M1 53C27 41 43 37 61 27Q70 23 79 27C101 39 118 42 139 54" stroke="#c18e59" strokeOpacity=".25" strokeWidth=".8" />
            <path d="M18 50C36 42 45 41 58 35M85 34C100 40 113 47 127 50" stroke="#2a160e" strokeOpacity=".28" strokeWidth=".7" />
            <path d="M57 28Q69 19 82 28M59 29Q70 23 80 29M61 30Q70 26 78 30" stroke="#3e2115" strokeOpacity=".34" strokeWidth=".55" />
            <path d="M9 46.4C22 38 43 28.4 57.6 22.4L61.8 17.7Q70 14.1 78.2 17.7L82.5 22.4C98 28.8 119 38.6 131 46.5" stroke={paint("wood-light")} strokeWidth="1.4" strokeLinecap="round" />
          </g>
          <ellipse cx="70" cy="16.7" rx="2.4" ry=".8" fill="#38251a" />
          <path d="M70 14.5V17.2" stroke={paint("metal")} strokeWidth="2" />
        </g>
      ) : null}

      {display === "clips" ? (
        <g className={styles.clips}>
          <rect x="66.8" y="18" width="6.4" height="12" rx="2" fill={paint("steel-face")} />
          <rect x="17" y="28" width="106" height="5" rx="2.5" fill={paint("steel-bar")} />
          <path d="M20 29.5H120" stroke="#f6f8ef" strokeOpacity=".8" strokeWidth=".6" />
          {[24, 100].map(x => (
            <g key={x}>
              <path d={`M${x} 29H${x + 16}L${x + 15} 46Q${x + 8} 49 ${x + 1} 46Z`} fill="#566159" />
              <path d={`M${x + 1} 29H${x + 15}L${x + 13.7} 44Q${x + 8} 47 ${x + 2.3} 44Z`} fill={paint("steel-face")} />
              <path d={`M${x + 2} 30H${x + 14}M${x + 3.2} 33H${x + 12.8}`} stroke="#f5f8ee" strokeWidth=".75" strokeOpacity=".85" />
              <rect x={x + 3} y="44" width="10" height="5" rx="1.2" fill="#4a5046" />
              <path d={`M${x + 4} 45H${x + 12}`} stroke="#8f9787" strokeWidth=".8" />
              <circle cx={x + 8} cy="37" r="2.3" fill="#7b867c" />
              <circle cx={x + 7.8} cy="36.7" r="1.6" fill={paint("steel-face")} />
              <path d={`M${x + 6.8} 36.7H${x + 8.8}`} stroke="#59645b" strokeWidth=".6" />
            </g>
          ))}
        </g>
      ) : null}

      {display === "hook" ? (
        <g className={styles.accessoryHook} strokeLinecap="round">
          <path d="M70 19V34C70 48 89 47 90 34" stroke="#48544b" strokeWidth="7" />
          <path d="M70 19V34C70 48 89 47 90 34" stroke={paint("steel-face")} strokeWidth="5.8" />
          <path d="M68.7 20V34C68.7 40 73.6 43.2 77.4 43.2" stroke="#f6f8ef" strokeWidth="1" strokeOpacity=".85" />
          <ellipse cx="90" cy="33.8" rx="3.3" ry="2.4" fill={paint("steel-bar")} />
          <path d="M66.6 20H73.4" stroke="#9aa496" strokeWidth="2" />
        </g>
      ) : null}

      {display === "shelf" ? (
        <g className={styles.tray}>
          <path d="M15 48V59Q15 61 18 61H122Q125 61 125 59V48" stroke="#536156" strokeWidth="4" />
          <path d="M15 48V58.8Q15 60 18 60H122Q125 60 125 58.8V48" stroke={paint("steel-face")} strokeWidth="2.6" />
          <path d="M5 48H135V53Q135 55 131 55H9Q5 55 5 53Z" fill={paint("wood-edge")} />
          <path data-shelf-surface data-depth={48 - shelfBack} d={shelfSurface} fill={paint("walnut")} />
          <g clipPath={paint("tray-clip")}><path d={`M4 ${shelfBack - 1}H136V50H4Z`} fill={paint("grain")} /></g>
          <path d={`M17 ${shelfBack}H123`} stroke={paint("wood-light")} strokeWidth=".6" />
          <path d="M6 48H134" stroke={paint("wood-light")} strokeWidth="1" />
          <path d="M9 53H131" stroke="#9a6441" strokeOpacity=".25" strokeWidth=".6" />
          <circle cx="15" cy="51" r="1.1" fill={paint("steel-face")} />
          <circle cx="125" cy="51" r="1.1" fill={paint("steel-face")} />
        </g>
      ) : null}
    </svg>
  );
}
