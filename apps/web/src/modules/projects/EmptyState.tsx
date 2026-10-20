import { EmptyState as SharedEmptyState, Button } from "../../components/ui";

interface EmptyStateProps {
  readonly archived: boolean;
  readonly onClearSearch: () => void;
  readonly onCreate: () => void;
  readonly searching: boolean;
}

export function EmptyState({
  archived,
  onClearSearch,
  onCreate,
  searching,
}: EmptyStateProps) {
  if (searching) {
    return (
      <SharedEmptyState title="没有找到相符的项目" action={<Button onClick={onClearSearch}>清空搜索</Button>}>换一个关键词，或者清空搜索后查看完整项目库。</SharedEmptyState>
    );
  }

  if (archived) {
    return (
      <SharedEmptyState title="这里还没有归档项目。">归档后的项目会保留在这里，并且可以随时恢复。</SharedEmptyState>
    );
  }

  return (
    <SharedEmptyState title="从第一个系列开始" action={<Button variant="primary" onClick={onCreate}>创建第一个项目</Button>}>创建一个项目，把灵感、面料、草图与生成方案整理在同一张设计白板上。</SharedEmptyState>
  );
}
