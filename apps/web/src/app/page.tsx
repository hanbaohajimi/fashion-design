import type { Metadata } from "next";

import { ProjectLibrary } from "../modules/projects/ProjectLibrary";

export const metadata: Metadata = {
  title: "从灵感到交付的服装设计工作室",
  description:
    "把设计简报、参考素材、服装方案、评审记录与交付资料放进同一条可以继续的创作链路。",
  robots: { index: true, follow: true },
  openGraph: {
    title: "从灵感到交付的服装设计工作室 · 森织",
    description:
      "把需求、参考、生成结果和交付资料放进同一条可以继续的服装设计工作流。",
    siteName: "森织设计工作室",
    type: "website",
  },
};

export default function HomePage() {
  return <ProjectLibrary />;
}
