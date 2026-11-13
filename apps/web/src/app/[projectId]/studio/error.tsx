"use client";

import { RouteError } from "../../../components/RouteError";

export default function StudioRouteError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <RouteError
      description="当前项目数据仍会保留；重新载入后会回到这份工作台。"
      error={error}
      retry={reset}
      title="工作台暂时无法打开"
    />
  );
}
