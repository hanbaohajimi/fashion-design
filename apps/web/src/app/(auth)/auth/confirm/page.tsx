import { Suspense } from "react";

import { ConfirmClient } from "./ConfirmClient";
import styles from "../../../../components/feedback.module.css";

export default function ConfirmPage() {
  return (
    <Suspense fallback={<main className={styles.page}>正在准备验证…</main>}>
      <ConfirmClient />
    </Suspense>
  );
}
