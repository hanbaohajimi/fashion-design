import { notFound } from "next/navigation";

export default async function ResultSelectionPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ v?: string; data?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { ResultSelectionPrototype } =
    await import("../../../prototypes/result-selection/ResultSelectionPrototype");
  const { FIXTURE_LABELS } =
    await import("../../../prototypes/result-selection/fixtures");
  const params = await searchParams;
  const value = Number(params.v ?? 1);
  const mode =
    params.data && Object.hasOwn(FIXTURE_LABELS, params.data)
      ? (params.data as keyof typeof FIXTURE_LABELS)
      : "demo";
  return (
    <ResultSelectionPrototype
      initialVariant={
        Number.isInteger(value) && value >= 1 && value <= 3 ? value - 1 : 0
      }
      initialMode={mode}
    />
  );
}
