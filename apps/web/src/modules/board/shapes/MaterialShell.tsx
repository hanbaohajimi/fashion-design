import { type CSSProperties, type ReactNode, useState } from "react";
import type { MaterialAppearance, Mount } from "./material-appearance";
import { generateEdgePath } from "./edge-path";
import { buildFabricSilhouette } from "./fabric-silhouette";
import { MountRenderer } from "./mount-renderers";
import styles from "./material-shell.module.css";

interface MaterialShellProps {
  readonly annotation?: ReactNode;
  readonly annotationScale?: number;
  readonly appearance: MaterialAppearance;
  readonly width: number;
  readonly height: number;
  readonly children: ReactNode;
  readonly lod?: "low" | "medium" | "high";
  /** User-placed mounts from shape.props.mounts */
  readonly userMounts?: readonly Mount[] | undefined;
  /** Called when the user removes a mount via the delete affordance */
  readonly onRemoveMount?: (mountId: string) => void;
}

export function computeAnnotationScale(
  width: number,
  height: number,
  referenceWidth: number,
  referenceHeight: number,
): number {
  if (
    width <= 0 ||
    height <= 0 ||
    referenceWidth <= 0 ||
    referenceHeight <= 0
  ) {
    return 1;
  }

  return Math.sqrt((width * height) / (referenceWidth * referenceHeight));
}

/**
 * MaterialShell renders the 4-layer material mounting system:
 * 1. Shadow Layer
 * 2. Substrate Layer (paper/fabric backing with texture)
 * 3. Content Layer (children)
 * 4. Mounting Layer (user-placed pins, tape, clips with interactive delete)
 */
export function MaterialShell({
  annotation,
  annotationScale = 1,
  appearance,
  width,
  height,
  children,
  lod = "high",
  userMounts,
  onRemoveMount,
}: MaterialShellProps) {
  const { substrate, edge, shadow, imperfections, seed } = appearance;

  const [hoveredMountId, setHoveredMountId] = useState<string | null>(null);

  // 诊断：记录 hover 事件
  const handleMountEnter = (mountId: string) => {
    console.log('🎯 Mount hover ENTER:', mountId);
    setHoveredMountId(mountId);
  };

  const handleMountLeave = () => {
    console.log('🎯 Mount hover LEAVE');
    setHoveredMountId(null);
  };

  const handleDeleteClick = (mountId: string, event: React.PointerEvent) => {
    console.log('🗑️ Delete button clicked:', mountId, event);
    if (onRemoveMount) {
      onRemoveMount(mountId);
    }
  };

  const clipPathId = `material-edge-${seed}`;

  // Cloth-specific geometry lives outside the rect-based generators.
  // Build the silhouette first so we can reuse its path for the clip/shadow
  // instead of calling buildFabricSilhouette twice.
  const isCloth = edge.style === "raw-cut";
  const clothGeo = isCloth
    ? buildFabricSilhouette(seed, width, height, edge.intensity)
    : null;
  const edgePath = clothGeo
    ? clothGeo.path
    : generateEdgePath(seed, width, height, edge.style, edge.intensity);

  const substrateWidth = width + substrate.padding * 2;
  const substrateHeight = height + substrate.padding * 2;

  const shadowBlur = shadow.softness;
  const shadowOpacity = 0.1 + shadow.elevation * 0.05;

  const renderTexture = lod !== "low";
  const renderImperfections = lod !== "low";

  const hasPins = userMounts != null && userMounts.length > 0;
  const safeAnnotationScale =
    Number.isFinite(annotationScale) && annotationScale > 0
      ? annotationScale
      : 1;
  const referenceShapeWidth = width / safeAnnotationScale;

  return (
    <div
      className={styles.materialShell}
      style={{
        width: `${substrateWidth}px`,
        height: `${substrateHeight}px`,
        top: `${-substrate.padding}px`,
        left: `${-substrate.padding}px`,
      }}
      data-material={substrate.material}
      data-lod={lod}
      data-pinned={hasPins ? "true" : undefined}
    >
      {/* Multi-layer shadow */}
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
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur * 0.3} />
              <feOffset dx={0} dy={1} result="shadow1" />
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur * 0.6} />
              <feOffset dx={shadow.offsetX * 0.5} dy={shadow.offsetY * 0.5} result="shadow2" />
              <feGaussianBlur in="SourceAlpha" stdDeviation={shadowBlur} />
              <feOffset dx={shadow.offsetX} dy={shadow.offsetY} result="shadow3" />
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

      {/* Substrate layer */}
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
                <filter id={`grain-${seed}`}>
                  <feTurbulence type="fractalNoise"
                    baseFrequency={0.02 + imperfections.grain * 0.015}
                    numOctaves="4" seed={seed} />
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope={0.25 + imperfections.grain * 0.2} intercept="0" />
                  </feComponentTransfer>
                  <feGaussianBlur stdDeviation="0.4" />
                </filter>
                <filter id={`fibers-${seed}`}>
                  <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed={seed + 500} />
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="discrete" tableValues="0 0 0.08 0.12" />
                  </feComponentTransfer>
                </filter>
                {renderImperfections && imperfections.crease > 0.05 && (
                  <filter id={`crease-${seed}`}>
                    <feTurbulence type="turbulence" baseFrequency="0.018" numOctaves="3" seed={seed + 1000} />
                    <feDisplacementMap in="SourceGraphic" scale={imperfections.crease * 40} />
                    <feGaussianBlur stdDeviation="3" />
                    <feComponentTransfer>
                      <feFuncA type="linear" slope={0.3} />
                    </feComponentTransfer>
                  </filter>
                )}
              </>
            )}
          </defs>

          <path d={edgePath} fill={substrate.tone} />

          {/* Cloth-specific: frayed edge strands and loose threads */}
          {isCloth && clothGeo && lod === "high" && (
            <>
              {clothGeo.frayPaths.map((d, i) => (
                <path
                  key={`f${i}`}
                  d={d}
                  fill="none"
                  stroke={substrate.tone}
                  strokeWidth={0.4 + (i % 3) * 0.15}
                  opacity={0.35 + (i % 5) * 0.08}
                  strokeLinecap="round"
                />
              ))}
              {clothGeo.threadPaths.map((d, i) => (
                <path
                  key={`t${i}`}
                  d={d}
                  fill="none"
                  stroke={substrate.tone}
                  strokeWidth={0.5 + (i % 2) * 0.2}
                  opacity={0.42 + (i % 4) * 0.06}
                  strokeLinecap="round"
                />
              ))}
            </>
          )}

          {substrate.material === "photo" && renderTexture && (
            <>
              <defs>
                <linearGradient id={`photo-gloss-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="rgb(255 255 255)" stopOpacity="0.35" />
                  <stop offset="40%"  stopColor="rgb(255 255 255)" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="rgb(255 255 255)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={edgePath} fill={`url(#photo-gloss-${seed})`} clipPath={`url(#${clipPathId})`} />
            </>
          )}

          {substrate.material === "fabric" && renderTexture && (
            <>
              <defs>
                <pattern id={`weave-${seed}`} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="6" y2="0" stroke="rgb(24 25 21)" strokeWidth="0.6" opacity="0.12" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(24 25 21)" strokeWidth="0.6" opacity="0.12" />
                  <line x1="0" y1="3" x2="6" y2="3" stroke="rgb(255 255 255)" strokeWidth="0.4" opacity="0.08" />
                  <line x1="3" y1="0" x2="3" y2="6" stroke="rgb(255 255 255)" strokeWidth="0.4" opacity="0.08" />
                </pattern>
              </defs>
              <rect width={substrateWidth} height={substrateHeight}
                fill={`url(#weave-${seed})`} clipPath={`url(#${clipPathId})`} />
            </>
          )}

          {substrate.material === "card" && renderTexture && (
            <>
              <defs>
                <linearGradient id={`card-edge-${seed}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="rgb(24 25 21)" stopOpacity="0.08" />
                  <stop offset="3%"   stopColor="rgb(24 25 21)" stopOpacity="0" />
                  <stop offset="97%"  stopColor="rgb(24 25 21)" stopOpacity="0" />
                  <stop offset="100%" stopColor="rgb(24 25 21)" stopOpacity="0.08" />
                </linearGradient>
              </defs>
              <rect width={substrateWidth} height={substrateHeight}
                fill={`url(#card-edge-${seed})`} clipPath={`url(#${clipPathId})`} />
              <rect x="0" y="0" width={substrateWidth} height="2"
                fill="rgb(255 255 255)" opacity="0.3" clipPath={`url(#${clipPathId})`} />
            </>
          )}

          {renderTexture && (
            <>
              <rect width={substrateWidth} height={substrateHeight}
                fill="rgb(24 25 21)" filter={`url(#grain-${seed})`}
                clipPath={`url(#${clipPathId})`} opacity={1} />
              <rect width={substrateWidth} height={substrateHeight}
                fill="white" filter={`url(#fibers-${seed})`}
                clipPath={`url(#${clipPathId})`} opacity={0.6} />
            </>
          )}

          {renderTexture && (
            <path d={edgePath} fill="none" stroke="rgb(255 255 255)"
              strokeWidth="1" opacity="0.2" clipPath={`url(#${clipPathId})`} />
          )}

          {renderImperfections && imperfections.crease > 0.05 && (
            <rect width={substrateWidth} height={substrateHeight}
              fill="rgb(24 25 21)" filter={`url(#crease-${seed})`}
              clipPath={`url(#${clipPathId})`} opacity={imperfections.crease * 0.25} />
          )}

          {renderImperfections && imperfections.cornerWear > 0.05 && (
            <>
              <defs>
                <radialGradient id={`corner-wear-${seed}`}>
                  <stop offset="0%"   stopColor="rgb(24 25 21)" stopOpacity={imperfections.cornerWear * 0.3} />
                  <stop offset="50%"  stopColor="rgb(24 25 21)" stopOpacity={imperfections.cornerWear * 0.15} />
                  <stop offset="100%" stopColor="rgb(24 25 21)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <ellipse cx="0" cy="0"
                rx={60 * imperfections.cornerWear} ry={60 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`} clipPath={`url(#${clipPathId})`} />
              <ellipse cx={substrateWidth} cy="0"
                rx={55 * imperfections.cornerWear} ry={55 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`} clipPath={`url(#${clipPathId})`} />
              <ellipse cx={substrateWidth} cy={substrateHeight}
                rx={65 * imperfections.cornerWear} ry={65 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`} clipPath={`url(#${clipPathId})`} />
              <ellipse cx="0" cy={substrateHeight}
                rx={58 * imperfections.cornerWear} ry={58 * imperfections.cornerWear}
                fill={`url(#corner-wear-${seed})`} clipPath={`url(#${clipPathId})`} />
            </>
          )}
        </svg>
      </div>

      {/* Content layer — clip to any non-straight edge so the photo follows the shape */}
      <div
        className={styles.contentLayer}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          left: `${substrate.padding}px`,
          top: `${substrate.padding}px`,
          clipPath: edge.style !== "straight" ? `url(#${clipPathId})` : undefined,
        }}
      >
        {children}
      </div>

      {/* Cloth overlay — drape shading drawn on top of the photo */}
      {isCloth && clothGeo && lod !== "low" && (
        <div className={styles.clothOverlay}
          style={{ width: `${substrateWidth}px`, height: `${substrateHeight}px` }}
        >
          <svg width={substrateWidth} height={substrateHeight} style={{ overflow: "visible" }}>
            <defs>
              <clipPath id={`${clipPathId}-overlay`}>
                <path d={edgePath} />
              </clipPath>
              <filter id={`crease-blur-${seed}`}>
                <feGaussianBlur stdDeviation="3.5" />
              </filter>
            </defs>

            {/* Soft fold shadows */}
            {clothGeo.creasePaths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="rgb(30 20 12)"
                strokeWidth={1.8 + (i % 2) * 0.8}
                opacity={0.055 + (i % 3) * 0.018}
                filter={`url(#crease-blur-${seed})`}
                clipPath={`url(#${clipPathId}-overlay)`}
              />
            ))}

            {/* Soft bulges — areas lifting off the board */}
            {clothGeo.bulges.map((b, i) => (
              <ellipse
                key={i}
                cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry}
                fill="rgb(255 252 248)"
                opacity={0.08}
                transform={`rotate(${b.rotate} ${b.cx} ${b.cy})`}
                clipPath={`url(#${clipPathId}-overlay)`}
              />
            ))}

            {/* Curl highlights — raised edge catches a sliver of reflected light */}
            {clothGeo.curls.map((c, i) => (
              <g key={i}>
                <path d={c.lift}  fill="rgb(255 255 255)" opacity={0.22} />
                <path d={c.shade} fill="rgb(20 14 8)"     opacity={0.14} />
              </g>
            ))}

            {/* Vignette — edges fall into shadow away from the fixed point */}
            <path
              d={edgePath}
              fill="none"
              stroke="rgb(24 18 10)"
              strokeWidth="8"
              opacity="0.10"
              clipPath={`url(#${clipPathId}-overlay)`}
            />
          </svg>
        </div>
      )}

      {/* Mounting layer — user-placed mounts with interactive delete */}
      {userMounts && userMounts.length > 0 && (
        <div
          className={`${styles.mountingLayer} ${onRemoveMount ? styles.mountingLayerInteractive : ""}`}
        >
          <svg
            width={substrateWidth}
            height={substrateHeight}
            style={{ overflow: "visible" }}
          >
            {userMounts.map((mount) => {
              // Convert normalized 0..1 to absolute pixel coords within the substrate SVG
              const mx = substrate.padding + mount.x * width;
              const my = substrate.padding + mount.y * height;
              const isHovered = hoveredMountId === mount.id;

              return (
                // Position is stored in current shape coordinates. The nested
                // scale keeps the fastener, hit target and delete affordance
                // proportional to the resized module.
                <g
                  key={mount.id}
                  onPointerEnter={() => handleMountEnter(mount.id)}
                  onPointerLeave={handleMountLeave}
                  transform={`translate(${mx}, ${my})`}
                >
                  <g className={styles.mountGroupAnimated}>
                    <g
                      data-mount-scale={safeAnnotationScale}
                      transform={`scale(${safeAnnotationScale})`}
                    >
                      {/* Invisible hit circle so small pins are easy to hover/click */}
                      <circle
                        r={16}
                        fill="transparent"
                        style={{
                          pointerEvents: onRemoveMount ? "all" : "none",
                          cursor: onRemoveMount ? "pointer" : "default",
                        }}
                      />
                      <MountRenderer
                        mount={{ ...mount, x: 0, y: 0 }}
                        referenceShapeWidth={referenceShapeWidth}
                      />
                      {/* Delete affordance — shown on hover */}
                      {isHovered && onRemoveMount && (
                        <g
                          onPointerDown={(e) => {
                            console.log('🔴 Delete button pointerdown');
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onPointerUp={(e) => {
                            console.log('🟢 Delete button pointerup');
                            e.stopPropagation();
                            e.preventDefault();
                            handleDeleteClick(mount.id, e);
                          }}
                          onClick={(e) => {
                            console.log('🔵 Delete button click');
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          style={{ cursor: "pointer", pointerEvents: "all" }}
                        >
                          <circle cx={10} cy={-10} r={8} fill="#ef4444" stroke="white" strokeWidth="1.2" />
                          <text
                            x={10} y={-10}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="white"
                            fontSize="10"
                            fontWeight="bold"
                            style={{ pointerEvents: "none", userSelect: "none" }}
                          >
                            ✕
                          </text>
                        </g>
                      )}
                    </g>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {annotation ? (
        <div
          className={styles.annotationLayer}
          style={{
            left: `${substrate.padding}px`,
            bottom: `${Math.round(
              height + substrate.padding + 8 * safeAnnotationScale,
            )}px`,
          }}
        >
          <div
            className={styles.annotationScale}
            style={
              {
                "--annotation-scale": safeAnnotationScale,
              } as CSSProperties
            }
          >
            {annotation}
          </div>
        </div>
      ) : null}
    </div>
  );
}
