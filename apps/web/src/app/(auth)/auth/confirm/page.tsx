import { Suspense } from "react";

import { ConfirmClient } from "./ConfirmClient";

export default function ConfirmPage() {
  return (
    <Suspense fallback={<main className="confirm-page">正在准备验证…</main>}>
      <ConfirmClient />
    </Suspense>
  );
}
