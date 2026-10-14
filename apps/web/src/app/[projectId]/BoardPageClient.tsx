"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { BoardSkeleton } from "../../modules/board/BoardSkeleton";
import { ErrorBoundary } from "../../observability/ErrorBoundary";
import { writeActiveBoardId } from "../../modules/trends/active-board";

const WorkflowCanvas = dynamic(
  () => import("../../modules/board/workflow/WorkflowCanvas"),
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
      <WorkflowCanvas key={projectId} projectId={projectId} />
    </ErrorBoundary>
  );
}
