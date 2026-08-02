import {
  getCompositionEntries,
  getFabricSeasons,
  type Fabric,
} from "./fabric-types";

export type FabricWeightFilter = "all" | "light" | "medium" | "heavy";

export interface FabricClientFilters {
  readonly composition: string;
  readonly season: string;
  readonly weight: FabricWeightFilter;
}

function matchesWeight(weight: number | undefined, filter: FabricWeightFilter) {
  if (filter === "all") return true;
  if (typeof weight !== "number" || !Number.isFinite(weight)) return false;
  if (filter === "light") return weight < 100;
  if (filter === "medium") return weight >= 100 && weight <= 200;
  return weight > 200;
}

export function filterFabrics(
  fabrics: readonly Fabric[],
  filters: FabricClientFilters,
): readonly Fabric[] {
  const composition = filters.composition.toLocaleLowerCase();
  const season = filters.season.toLocaleLowerCase();

  return fabrics.filter((fabric) => {
    const compositionMatches =
      composition === "all" ||
      getCompositionEntries(fabric.attributes).some(
        ([name, percentage]) =>
          percentage > 0 && name.toLocaleLowerCase() === composition,
      );
    const seasonMatches =
      season === "all" ||
      getFabricSeasons(fabric.attributes).some(
        (item) => item.toLocaleLowerCase() === season,
      );

    return (
      compositionMatches &&
      seasonMatches &&
      matchesWeight(fabric.attributes.weight, filters.weight)
    );
  });
}
