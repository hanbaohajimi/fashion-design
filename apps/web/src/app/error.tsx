"use client";

import { RouteError } from "../components/RouteError";

export default function RouteSegmentError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <RouteError
      description="项目数据仍会保留，可以重新载入继续工作。"
      error={error}
      retry={reset}
      title="这页暂时没有准备好"
    />
  );
}
