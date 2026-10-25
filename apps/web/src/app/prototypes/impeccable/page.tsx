import { notFound } from "next/navigation";

export default async function ImpeccablePrototypePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { ImpeccableComparison } =
    await import("../../../prototypes/impeccable/ImpeccableComparison");
  return <ImpeccableComparison />;
}
