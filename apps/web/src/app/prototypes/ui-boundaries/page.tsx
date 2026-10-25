import { notFound } from "next/navigation";
export default async function UiBoundariesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { UiBoundaries } =
    await import("../../../prototypes/result-selection/UiBoundaries");
  return <UiBoundaries />;
}
