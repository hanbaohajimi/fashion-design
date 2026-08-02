"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { BoardSkeleton } from "../../modules/board/BoardSkeleton";
import { ErrorBoundary } from "../../observability/ErrorBoundary";
import { writeActiveBoardId } from "../../modules/trends/active-board";

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
  useEffect(() => {
    writeActiveBoardId(projectId);
  }, [projectId]);

  return (
    <ErrorBoundary area="board">
      <BoardCanvas key={projectId} projectId={projectId} />
    </ErrorBoundary>
  );
}
