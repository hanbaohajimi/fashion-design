"use client";

import { RouteError } from "../../../components/RouteError";

export default function ReviewRouteError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <RouteError
      description="评审资料可能正在更新，或网络暂时不可用；你可以重新载入或返回项目库。"
      error={error}
      retry={reset}
      title="这份评审暂时无法打开"
    />
  );
}
