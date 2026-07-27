import { BoardPageClient } from "./BoardPageClient";

interface BoardPageProps {
  readonly params: Promise<{
    readonly projectId: string;
  }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { projectId } = await params;
  return <BoardPageClient projectId={projectId} />;
}
