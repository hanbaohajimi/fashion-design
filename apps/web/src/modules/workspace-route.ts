/** Static pages must never become project IDs, draft scopes or creative visits. */
const STATIC_ROUTES = new Set([
  "projects",
  "assets",
  "wardrobe",
  "fabrics",
  "trends",
  "login",
  "auth",
  "share",
  "review",
  "prototypes",
]);
export function workspaceRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0];
  const projectId =
    first &&
    !STATIC_ROUTES.has(first) &&
    /^[a-zA-Z0-9-]+$/u.test(first) &&
    (parts.length === 1 || (parts.length === 2 && parts[1] === "studio"))
      ? first
      : null;
  const canvas = Boolean(projectId && parts.length === 1);
  return {
    projectId,
    canvas,
    studio: Boolean(projectId && parts[1] === "studio"),
    independent: Boolean(
      first &&
      ["login", "auth", "share", "review", "prototypes"].includes(first),
    ),
    document: !canvas,
  };
}
