import { SharedImage } from "../../../modules/board/workflow/SharedImage";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "分享的图片",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedImage token={token} />;
}
