import type { Metadata } from "next";

import { ReviewShare } from "../../../modules/studio-shares/ReviewShare";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "只读评审",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ReviewSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ReviewShare token={token} />;
}

