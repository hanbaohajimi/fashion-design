import type { Fabric } from "./fabric-types";

export function canManageFabric(fabric: Fabric): boolean {
  return fabric.canManage;
}

export function filterFabricsByTag(
  fabrics: readonly Fabric[],
  query: string,
): readonly Fabric[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return fabrics;
  return fabrics.filter((fabric) =>
    fabric.tags.some((tag) => tag.toLocaleLowerCase().includes(normalized)),
  );
}
