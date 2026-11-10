/** Open the existing task center on the current project surface. */
export function requestProjectTaskCenter(projectId: string) {
  window.dispatchEvent(new CustomEvent("fashion-project:tasks", { detail: { projectId } }));
}
