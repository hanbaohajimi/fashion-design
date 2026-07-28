"use client";

import dynamic from "next/dynamic";

import { BoardSkeleton } from "../../modules/board/BoardSkeleton";
import { ErrorBoundary } from "../../observability/ErrorBoundary";

const BoardCanvas = dynamic(
  () => import("../../modules/board/BoardCanvas"),
  {
    loading: () => <BoardSkeleton />,
    ssr: false,
  },
);

interface BoardPageClientProps {
  readonly projectId: string;
}

export function BoardPageClient({ projectId }: BoardPageClientProps) {
  return (
    <ErrorBoundary area="board">
      <BoardCanvas key={projectId} projectId={projectId} />
    </ErrorBoundary>
  );
}
