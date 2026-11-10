/** Recognizes this deployment's storage only; callers still enforce ownership. */
export function privateStorageObjectKey(
  value: string,
  config: {
    endpoint?: string | undefined;
    bucket?: string | undefined;
    cdnOrigin?: string | undefined;
  },
): string | null {
  if (value.startsWith("s3://")) return value.slice(5) || null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (config.cdnOrigin) {
      const base = new URL(`${config.cdnOrigin.replace(/\/+$/, "")}/`);
      if (url.origin === base.origin && url.pathname.startsWith(base.pathname))
        return (
          decodeURIComponent(url.pathname.slice(base.pathname.length)) || null
        );
    }
    if (config.endpoint && config.bucket) {
      const base = new URL(config.endpoint);
      const prefix = `${base.pathname.replace(/\/+$/, "")}/${config.bucket}/`;
      if (url.origin === base.origin && url.pathname.startsWith(prefix))
        return decodeURIComponent(url.pathname.slice(prefix.length)) || null;
      const virtual = new URL(base);
      virtual.hostname = `${config.bucket}.${base.hostname}`;
      const virtualPrefix = `${base.pathname.replace(/\/+$/, "")}/`;
      if (
        url.origin === virtual.origin &&
        url.pathname.startsWith(virtualPrefix)
      )
        return (
          decodeURIComponent(url.pathname.slice(virtualPrefix.length)) || null
        );
    }
  } catch {
    return null;
  }
  return null;
}
