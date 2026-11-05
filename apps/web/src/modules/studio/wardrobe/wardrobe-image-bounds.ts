"use client";

import { useEffect, useState } from "react";
import type { WardrobeImageBounds } from "@fashion/shared";
import { privateFetch, privateRequestSignal } from "../../auth/private-fetch";

type Entry = { promise: Promise<WardrobeImageBounds | undefined>; expiresAt: number; pending: boolean };
const scopes = new WeakMap<AbortSignal, Map<string, Entry>>();
const MAX_ENTRIES = 256;
const FAILURE_RETRY_MS = 30_000;

function cacheFor(scope: AbortSignal): Map<string, Entry> {
  const existing = scopes.get(scope);
  if (existing) return existing;
  const cache = new Map<string, Entry>();
  scopes.set(scope, cache);
  scope.addEventListener("abort", () => cache.clear(), { once: true });
  return cache;
}

function isBounds(value: unknown): value is WardrobeImageBounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as WardrobeImageBounds;
  return [bounds.width, bounds.height, bounds.x, bounds.y, bounds.contentWidth, bounds.contentHeight]
    .every(number => Number.isSafeInteger(number))
    && bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.y >= 0
    && bounds.contentWidth > 0 && bounds.contentHeight > 0
    && bounds.x + bounds.contentWidth <= bounds.width
    && bounds.y + bounds.contentHeight <= bounds.height;
}

function readBounds(projectId: string, assetId: string, scope: AbortSignal): Promise<WardrobeImageBounds | undefined> {
  const cache = cacheFor(scope);
  const key = JSON.stringify([projectId, assetId]);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache].find(([, entry]) => !entry.pending);
    if (oldest) cache.delete(oldest[0]);
  }
  const entry: Entry = { promise: Promise.resolve(undefined), expiresAt: Infinity, pending: true };
  entry.promise = (async () => {
    try {
      const response = await privateFetch(`/api/projects/${encodeURIComponent(projectId)}/wardrobe/assets/${encodeURIComponent(assetId)}/bounds`, {
        method: "GET", credentials: "include", cache: "no-store", signal: scope,
      });
      if (!response.ok) return undefined;
      const value: unknown = await response.json();
      return !scope.aborted && isBounds(value) ? value : undefined;
    } catch {
      // Unavailable bounds retain the existing full-image display; they never change an asset.
      return undefined;
    }
  })().then(value => {
    entry.pending = false;
    if (!value) entry.expiresAt = Date.now() + FAILURE_RETRY_MS;
    return value;
  });
  cache.set(key, entry);
  return entry.promise;
}

/** Read-only, account-scoped metadata shared by candidate previews and existing revisions. */
export function useWardrobeImageBounds(projectId?: string, assetId?: string, knownBounds?: WardrobeImageBounds): WardrobeImageBounds | undefined {
  const scope = privateRequestSignal();
  const key = JSON.stringify([projectId, assetId]);
  const [loaded, setLoaded] = useState<{ key: string; scope: AbortSignal; bounds: WardrobeImageBounds | undefined } | null>(null);
  useEffect(() => {
    if (!projectId || !assetId || knownBounds || scope.aborted) return;
    let active = true;
    void readBounds(projectId, assetId, scope).then(bounds => {
      if (active && !scope.aborted) setLoaded({ key, scope, bounds });
    });
    return () => { active = false; };
  }, [projectId, assetId, knownBounds, scope, key]);
  if (scope.aborted) return undefined;
  return knownBounds ?? (loaded?.key === key && loaded.scope === scope ? loaded.bounds : undefined);
}
