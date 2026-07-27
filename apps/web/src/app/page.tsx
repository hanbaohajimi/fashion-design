import { PLATFORM_NAME } from "@fashion/shared";

import { HomeSession } from "../modules/auth/HomeSession";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">MONOREPO READY</p>
      <h1>{PLATFORM_NAME}</h1>
      <p className="description">专业设计工作流，从结构化灵感开始。</p>
      <HomeSession />
    </main>
  );
}
