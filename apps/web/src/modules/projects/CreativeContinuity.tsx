"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { rememberCreativeVisit } from "./creative-memory";
export function CreativeContinuity() {
  const pathname = usePathname();
  const { session } = useAuth();
  useEffect(() => {
    const match = /^\/([a-zA-Z0-9-]+)(?:\/studio)?$/u.exec(pathname);
    const projectId = match?.[1];
    if (!session || !projectId || ["login", "fabrics", "trends"].includes(projectId)) return;
    const save = () => { if (window.location.pathname === pathname) rememberCreativeVisit(session.user.id, projectId, window.location.pathname + window.location.search); };
    save();
    document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => { save(); document.removeEventListener("visibilitychange", save); window.removeEventListener("pagehide", save); };
  }, [pathname, session]);
  return null;
}
