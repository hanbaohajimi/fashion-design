import { type ReactNode } from "react";
import type { MaterialAppearance } from "./material-appearance";
import { generateEdgePath } from "./edge-path";
import { MountRenderer } from "./mount-renderers";
import styles from "./material-shell.module.css";

interface MaterialShellProps {
  readonly appearance: MaterialAppearance;
  readonly width: number;
  readonly height: number;
  readonly children: ReactNode;
  readonly lod?: "low" | "medium" | "high";
}

/**
 * MaterialShell renders the 4-layer material mounting system:
 * 1. Content Layer (children)
 * 2. Substrate Layer (paper/fabric backing with texture)
 * 3. Mounting Layer (pins, tape, clips)
 * 4. Annotation Layer (pencil marks, stamps - future)
 */
export function MaterialShell({
  appearance,
  width,
  height,
  children,
  lod = "high",
}: MaterialShellProps) {
  const { substrate, edge, mounts, shadow, imperfections, seed } = appearance;

  // Generate deterministic edge path
  const clipPathId = `material-edge-${seed}`;
  const edgePath = generateEdgePath(seed, width, height, edge.style, edge.intensity);

  // Calculate substrate dimensions with padding
  const substrateWidth = width + substrate.padding * 2;
  const substrateHeight = height + substrate.padding * 2;

  // Enhanced shadow with multiple layers for depth
  const shadowBlur = shadow.softness;
  const shadowOpacity = 0.1 + shadow.elevation * 0.05;

  // LOD: skip expensive features at low zoom
  const renderTexture = lod !== "low";
  const renderMounts = lod !== "low";
  const renderImperfections = lod === "high";

  return (
    <div
      className={styles.materialShell}
      style={{
        width: `${substrateWidth}px`,
        height: `${substrateHeight}px`,
        transform: `translate(${-substrate.padding}px, ${-substrate.padding}px)`,
      }}
      data-material={substrate.material}
      data-lod={lod}
    >
      {/* Multi-layer shadow for realistic depth */}
      <div
        className={styles.shadowLayer}
        style={{
          width: `${substrateWidth}px`,
          height: `${substrateHeight}px`,
          transform: `translate(${shadow.offsetX}px, ${shadow.offsetY}px)`,
        }}
      >
        <svg width={substrateWidth} height={substrateHeight} style={{ overflow: "visible" }}>
          <defs>
            <filter id={`shadow-${seed}`}>
              {/* Sharp contact shadow */}
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur * 0.3} />
              <feOffset dx={0} dy={1} result="shadow1" />

              {/* Mid-range shadow */}
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur * 0.6} />
              <feOffset dx={shadow.offsetX * 0.5} dy={shadow.offsetY * 0.5} result="shadow2" />

              {/* Soft ambient shadow */}
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur} />
              <feOffset dx={shadow.offsetX} dy={shadow.offsetY} result="shadow3" />

              {/* Composite all shadows */}
              <feMerge>
                <feMergeNode in="shadow3" />
                <feMergeNode in="shadow2" />
                <feMergeNode in="shadow1" />
              </feMerge>

              <feComponentTransfer>
                <feFuncA type="linear" slope={shadowOpacity} />
              </feComponentTransfer>
            </filter>
          </defs>
          <path d={edgePath} fill="rgb(24 25 21)" filter={`url(#shadow-${seed})`} />
        </svg>
      </div>

      {/* Substrate layer - the physical paper/fabric backing */}
      <div
        className={styles.substrateLayer}
        style={{
          width: `${substrateWidth}px`,
          height: `${substrateHeight}px`,
          backgroundColor: substrate.tone,
          opacity: substrate.opacity,
        }}
      >
        <svg width={substrateWidth} height={substrateHeight} style={{ overflow: "visible" }}>
          <defs>
            <clipPath id={clipPathId}>
              <path d={edgePath} />
            </clipPath>
            {renderTexture && (
              <>
                {/* Enhanced paper grain texture with multiple frequencies */}
                <filter id={`grain-${seed}`}>
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency={0.65 + imperfections.grain * 0.35}
                    numOctaves="5"
                    seed={seed}
                  />
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope={0.08 + imperfections.grain * 0.12} intercept="0" />
                  </feComponentTransfer>
                  <feGaussianBlur stdDeviation="0.3" />
                </filter>

                {/* Fine paper fibers overlay */}
                <filter id={`fibers-${seed}`}>
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="2.5"
                    numOctaves="3"
                    seed={seed + 500}
                  />
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="discrete" tableValues="0 0 0.03 0.05" />
                  </feComponentTransfer>
                </filter>

                {/* Subtle crease shadows with improved realism */}
                {renderImperfections && imperfections.crease > 0.05 && (
                  <filter id={`crease-${seed}`}>
                    <feTurbulence
                      type="turbulence"
                      baseFrequency="0.015"
                      numOctaves="3"
                      seed={seed + 1000}
                    />
                    <feDisplacementMap in="SourceGraphic" scale={imperfections.crease * 25} />
                    <feGaussianBlur stdDeviation="2" />
                    <feComponentTransfer>
                      <feFuncA type="linear" slope={0.15} />
                    </feComponentTransfer>
                  </filter>
                )}

                {/* Edge highlights - paper thickness */}
                <filter id={`edge-highlight-${seed}`}>
                  <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
                  <feOffset dx="0" dy="-1" result="offsetblur" />
                  <feFlood floodColor="rgb(255 255 255)" floodOpacity="0.4" />
                  <feComposite in2="offsetblur" operator="in" />
                </filter>
              </>
            )}
          </defs>

          {/* Base substrate shape */}
          <path
            d={edgePath}
            fill={substrate.tone}
            clipPath={`url(#${clipPathId})`}
          />

          {/* Paper grain texture overlay */}
          {renderTexture && (
            <>
              <rect
                width={substrateWidth}
                height={substrateHeight}
                fill="rgb(24 25 21)"
                filter={`url(#grain-${seed})`}
                clipPath={`url(#${clipPathId})`}
                opacity={0.7}
              />
              <rect
                width={substrateWidth}
                height={substrateHeight}
                fill="white"
                filter={`url(#fibers-${seed})`}
                clipPath={`url(#${clipPathId})`}
                opacity={0.4}
              />
            </>
          )}

          {/* Edge thickness highlight */}
          {renderTexture && (
            <path
              d={edgePath}
              fill="none"
              stroke="rgb(255 255 255)"
              strokeWidth="1"
              opacity="0.2"
              clipPath={`url(#${clipPathId})`}
            />
          )}

          {/* Crease overlay */}
          {renderImperfections && imperfections.crease > 0.05 && (
            <rect
              width={substrateWidth}
              height={substrateHeight}
              fill="rgb(24 25 21)"
              filter={`url(#crease-${seed})`}
              clipPath={`url(#${clipPathId})`}
              opacity={imperfections.crease * 0.12}
            />
          )}

          {/* Enhanced corner wear with gradient falloff */}
          {renderImperfections && imperfections.cornerWear > 0.05 && (
            <>
              <defs>
                <radialGradient id={`corner-wear-${seed}`}>
                  <stop offset="0%" stopColor="rgb(24 25 21)" stopOpacity={imperfections.cornerWear * 0.15} />
                  <stop offset="100%" stopColor="rgb(24 25 21)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <ellipse
                cx="0"
                cy="0"
                rx={40 * imperfections.cornerWear}
                ry={40 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`}
                clipPath={`url(#${clipPathId})`}
              />
              <ellipse
                cx={substrateWidth}
                cy="0"
                rx={35 * imperfections.cornerWear}
                ry={35 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`}
                clipPath={`url(#${clipPathId})`}
              />
              <ellipse
                cx={substrateWidth}
                cy={substrateHeight}
                rx={45 * imperfections.cornerWear}
                ry={45 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`}
                clipPath={`url(#${clipPathId})`}
              />
              <ellipse
                cx="0"
                cy={substrateHeight}
                rx={38 * imperfections.cornerWear}
                ry={38 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`}
                clipPath={`url(#${clipPathId})`}
              />
            </>
          )}
        </svg>
      </div>

      {/* Content layer - the actual shape content */}
      <div
        className={styles.contentLayer}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          left: `${substrate.padding}px`,
          top: `${substrate.padding}px`,
        }}
      >
        {children}
      </div>

      {/* Mounting layer - pins, tape, clips */}
      {renderMounts && mounts.length > 0 && (
        <div className={styles.mountingLayer}>
          <svg
            width={substrateWidth}
            height={substrateHeight}
            style={{ overflow: "visible", pointerEvents: "none" }}
          >
            {mounts.map((mount) => (
              <MountRenderer
                key={mount.id}
                mount={mount}
                shapeWidth={substrateWidth}
                shapeHeight={substrateHeight}
              />
            ))}
          </svg>
        </div>
      )}

      {/* Annotation layer - future: pencil marks, stamps, arrows */}
      {/* Reserved for phase 2 */}
    </div>
  );
}
