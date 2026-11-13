"use client";

import { RouteError } from "../../components/RouteError";

export default function ProjectRouteError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <RouteError
      description="项目数据仍会保留；重新载入会重新获取工作区状态。"
      error={error}
      retry={reset}
      title="项目工作区暂时无法打开"
    />
  );
}
