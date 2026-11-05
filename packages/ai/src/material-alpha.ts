/** An algorithm-derived candidate, never a claim of provider-native transparency. */
export const MATERIAL_ALPHA_ALGORITHM =
  "green-dominance-original-rgb-v1" as const;
export const MASKED_PROVIDER_RGB_ALGORITHM =
  "masked-provider-rgb-preserve-alpha-v1" as const;
export const MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM =
  "masked-provider-rgb-interior-v2" as const;
export const MASKED_RGB_ALPHA_THRESHOLD = 240 as const;
export const MASKED_RGB_INTERIOR_RADIUS = 2 as const;

export interface MaterialAlphaRgbaImage {
  width: number;
  height: number;
  /** Unpremultiplied RGBA bytes in row-major order. Node Buffer is supported. */
  data: Uint8Array;
}

export interface MaterialAlphaStats {
  pixelCount: number;
  editablePixels: number;
  protectedPixels: number;
  changedAlphaPixels: number;
  fullyTransparentPixels: number;
  partiallyTransparentPixels: number;
  opaquePixels: number;
}

export interface MaterialAlphaResult extends MaterialAlphaRgbaImage {
  algorithm: typeof MATERIAL_ALPHA_ALGORITHM;
  stats: MaterialAlphaStats;
}

const MAX_PIXELS = 16_777_216;

function byte(data: Uint8Array, offset: number): number {
  const value = data[offset];
  if (value === undefined) throw new Error("RGBA input buffer is incomplete");
  return value;
}

function validateImage(image: MaterialAlphaRgbaImage, name: string): void {
  if (
    !image ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > MAX_PIXELS / image.height
  )
    throw new Error(
      `${name}: RGBA dimensions must contain 1–${MAX_PIXELS} pixels`,
    );
  if (
    !(image.data instanceof Uint8Array) ||
    image.data.length !== image.width * image.height * 4
  )
    throw new Error(`${name}: RGBA byte length does not match dimensions`);
}

/**
 * Estimate alpha only from an explicitly requested green-hole probe for light
 * lace/net regions. This is not a general keyer or a physical transmission model.
 *
 * source supplies every output RGB byte and the maximum allowed alpha. The
 * probe's green dominance estimates alpha; its own alpha is not used. mask alpha
 * 0 means editable, 255 protected, intermediate values feather that edit. Mask
 * RGB is ignored. All inputs remain unchanged, including shared Buffer views.
 * No blur, threshold, detail gain, color correction, or image resampling occurs.
 */
export function deriveMaterialAlpha({
  source,
  probe,
  mask,
}: {
  source: MaterialAlphaRgbaImage;
  probe: MaterialAlphaRgbaImage;
  mask: MaterialAlphaRgbaImage;
}): MaterialAlphaResult {
  for (const [name, image] of [
    ["source", source],
    ["probe", probe],
    ["mask", mask],
  ] as const)
    validateImage(image, name);
  if (
    probe.width !== source.width ||
    probe.height !== source.height ||
    mask.width !== source.width ||
    mask.height !== source.height
  )
    throw new Error(
      "Source, probe and mask must have identical RGBA dimensions",
    );

  // The constructor copies even when source.data is a Buffer whose slice aliases.
  const data = new Uint8Array(source.data);
  const stats: MaterialAlphaStats = {
    pixelCount: source.width * source.height,
    editablePixels: 0,
    protectedPixels: 0,
    changedAlphaPixels: 0,
    fullyTransparentPixels: 0,
    partiallyTransparentPixels: 0,
    opaquePixels: 0,
  };
  for (let offset = 0; offset < data.length; offset += 4) {
    const sourceAlpha = byte(source.data, offset + 3);
    const maskAlpha = byte(mask.data, offset + 3);
    let outputAlpha = sourceAlpha;
    if (maskAlpha === 255) {
      stats.protectedPixels++;
    } else {
      stats.editablePixels++;
      const editable = 1 - maskAlpha / 255;
      const redBlue = Math.max(
        byte(probe.data, offset),
        byte(probe.data, offset + 2),
      );
      const green = byte(probe.data, offset + 1);
      const estimated = green > redBlue ? redBlue / green : 1;
      const alpha = estimated * sourceAlpha;
      outputAlpha = Math.round(sourceAlpha * (1 - editable) + alpha * editable);
      data[offset + 3] = outputAlpha;
      if (outputAlpha !== sourceAlpha) stats.changedAlphaPixels++;
    }
    if (outputAlpha === 0) stats.fullyTransparentPixels++;
    else if (outputAlpha === 255) stats.opaquePixels++;
    else stats.partiallyTransparentPixels++;
  }
  return {
    width: source.width,
    height: source.height,
    data,
    algorithm: MATERIAL_ALPHA_ALGORITHM,
    stats,
  };
}

/** Preserve source alpha and protected RGBA; accept provider RGB only inside the selected region. */
export function deriveMaskedProviderRgb({
  source,
  probe,
  mask,
}: {
  source: MaterialAlphaRgbaImage;
  probe: MaterialAlphaRgbaImage;
  mask: MaterialAlphaRgbaImage;
}): MaterialAlphaRgbaImage & {
  algorithm: typeof MASKED_PROVIDER_RGB_ALGORITHM;
  stats: {
    pixelCount: number;
    editablePixels: number;
    protectedPixels: number;
    changedRgbPixels: number;
  };
} {
  for (const [name, image] of [
    ["source", source],
    ["probe", probe],
    ["mask", mask],
  ] as const)
    validateImage(image, name);
  if (
    probe.width !== source.width ||
    probe.height !== source.height ||
    mask.width !== source.width ||
    mask.height !== source.height
  )
    throw new Error(
      "Source, probe and mask must have identical RGBA dimensions",
    );
  const data = new Uint8Array(source.data);
  const stats = {
    pixelCount: source.width * source.height,
    editablePixels: 0,
    protectedPixels: 0,
    changedRgbPixels: 0,
  };
  for (let offset = 0; offset < data.length; offset += 4) {
    const maskAlpha = byte(mask.data, offset + 3);
    if (maskAlpha === 255) {
      stats.protectedPixels++;
      continue;
    }
    stats.editablePixels++;
    // Invisible exterior pixels remain exact too; this operation never creates a silhouette.
    if (byte(source.data, offset + 3) === 0) continue;
    const weight = 1 - maskAlpha / 255;
    let changed = false;
    for (let channel = 0; channel < 3; channel++) {
      const original = byte(source.data, offset + channel);
      const output = Math.round(
        original * (1 - weight) + byte(probe.data, offset + channel) * weight,
      );
      data[offset + channel] = output;
      if (output !== original) changed = true;
    }
    if (changed) stats.changedRgbPixels++;
  }
  return {
    width: source.width,
    height: source.height,
    data,
    algorithm: MASKED_PROVIDER_RGB_ALGORITHM,
    stats,
  };
}

/** Fixed 2px square erosion of alpha>=240; canvas exterior counts as non-interior. */
export function maskedRgbInteriorEligibility(
  source: MaterialAlphaRgbaImage,
): Uint8Array {
  validateImage(source, "source");
  const eligible = new Uint8Array(source.width * source.height);
  const radius = MASKED_RGB_INTERIOR_RADIUS;
  for (let y = radius; y < source.height - radius; y++) {
    for (let x = radius; x < source.width - radius; x++) {
      let interior = true;
      for (let dy = -radius; dy <= radius && interior; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (
            byte(source.data, ((y + dy) * source.width + x + dx) * 4 + 3) <
            MASKED_RGB_ALPHA_THRESHOLD
          ) {
            interior = false;
            break;
          }
        }
      }
      if (interior) eligible[y * source.width + x] = 1;
    }
  }
  return eligible;
}

/** Independent of provider output; used before accepting a paid internal correction. */
export function inspectMaskedRgbInterior({
  source,
  mask,
}: {
  source: MaterialAlphaRgbaImage;
  mask: MaterialAlphaRgbaImage;
}) {
  validateImage(source, "source");
  validateImage(mask, "mask");
  if (mask.width !== source.width || mask.height !== source.height)
    throw new Error("Source and mask must have identical RGBA dimensions");
  const eligible = maskedRgbInteriorEligibility(source);
  const stats = {
    pixelCount: eligible.length,
    selectedPixels: 0,
    editablePixels: 0,
    protectedPixels: 0,
    alphaProtectedPixels: 0,
    boundaryProtectedPixels: 0,
    alphaThreshold: MASKED_RGB_ALPHA_THRESHOLD,
    interiorRadius: MASKED_RGB_INTERIOR_RADIUS,
  };
  for (let pixel = 0; pixel < eligible.length; pixel++) {
    const selected = byte(mask.data, pixel * 4 + 3) < 255;
    if (selected) stats.selectedPixels++;
    if (selected && eligible[pixel]) stats.editablePixels++;
    else stats.protectedPixels++;
    if (!eligible[pixel]) {
      if (byte(source.data, pixel * 4 + 3) < MASKED_RGB_ALPHA_THRESHOLD)
        stats.alphaProtectedPixels++;
      else stats.boundaryProtectedPixels++;
    }
  }
  return { eligible, stats };
}

/** V2 keeps all edge RGB as well as all alpha; V1 remains available for historical evidence. */
export function deriveMaskedProviderRgbInterior({
  source,
  probe,
  mask,
}: {
  source: MaterialAlphaRgbaImage;
  probe: MaterialAlphaRgbaImage;
  mask: MaterialAlphaRgbaImage;
}) {
  validateImage(probe, "probe");
  if (probe.width !== source.width || probe.height !== source.height)
    throw new Error(
      "Source, probe and mask must have identical RGBA dimensions",
    );
  const { eligible, stats } = inspectMaskedRgbInterior({ source, mask });
  const data = new Uint8Array(source.data);
  let changedRgbPixels = 0;
  for (let pixel = 0; pixel < eligible.length; pixel++) {
    const offset = pixel * 4;
    const maskAlpha = byte(mask.data, offset + 3);
    if (!eligible[pixel] || maskAlpha === 255) continue;
    const weight = 1 - maskAlpha / 255;
    let changed = false;
    for (let channel = 0; channel < 3; channel++) {
      const original = byte(source.data, offset + channel);
      const output = Math.round(
        original * (1 - weight) + byte(probe.data, offset + channel) * weight,
      );
      data[offset + channel] = output;
      if (output !== original) changed = true;
    }
    if (changed) changedRgbPixels++;
  }
  return {
    width: source.width,
    height: source.height,
    data,
    algorithm: MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM,
    stats: { ...stats, changedRgbPixels },
  };
}
