export const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY?.trim();
export const tldrawLicenseRequired =
  process.env.NODE_ENV === "production" && !tldrawLicenseKey;
