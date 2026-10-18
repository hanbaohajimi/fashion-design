"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { navigateAfterSave } from "./navigation";

/** Private workspace actions must await outstanding saves before navigating. */
export function useGuardedRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push: (...args: Parameters<typeof router.push>) => navigateAfterSave(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) => navigateAfterSave(() => router.replace(...args)),
    back: () => navigateAfterSave(() => router.back()),
    forward: () => navigateAfterSave(() => router.forward()),
  }), [router]);
}
