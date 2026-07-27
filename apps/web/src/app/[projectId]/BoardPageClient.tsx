"use client";

import dynamic from "next/dynamic";

import { BoardSkeleton } from "../../modules/board/BoardSkeleton";

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
  return <BoardCanvas key={projectId} projectId={projectId} />;
}
