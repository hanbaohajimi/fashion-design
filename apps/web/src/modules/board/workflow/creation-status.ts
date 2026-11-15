import type { CreationRunView } from "@fashion/shared";

export function creationStatusLabel(status: CreationRunView["status"]): string {
  return { draft: "待提交", preparing: "正在确认提交", queued: "排队中", running: "生成中", completed: "已完成", partial_failed: "部分完成", failed: "失败", canceled: "已取消" }[status];
}
