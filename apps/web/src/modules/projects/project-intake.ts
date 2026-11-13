export interface ProjectIntakeStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const MAX_BRIEF_LENGTH = 1_200;
const keyFor = (projectId: string): string =>
  `fashion:project-intake:${projectId}`;

export function writeProjectIntake(
  storage: ProjectIntakeStorage,
  projectId: string,
  brief: string,
): void {
  const value = brief.trim().slice(0, MAX_BRIEF_LENGTH);
  if (!value) return;
  storage.setItem(keyFor(projectId), JSON.stringify({ brief: value, version: 1 }));
}

export function readProjectIntake(
  storage: ProjectIntakeStorage,
  projectId: string,
): string | null {
  const brief = peekProjectIntake(storage, projectId);
  clearProjectIntake(storage, projectId);
  return brief;
}

export function peekProjectIntake(
  storage: ProjectIntakeStorage,
  projectId: string,
): string | null {
  const key = keyFor(projectId);
  let raw: string | null = null;
  raw = storage.getItem(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const brief = (parsed as { brief?: unknown }).brief;
  return typeof brief === "string" && brief.trim()
    ? brief.trim().slice(0, MAX_BRIEF_LENGTH)
    : null;
}

export function clearProjectIntake(
  storage: ProjectIntakeStorage,
  projectId: string,
): void {
  storage.removeItem(keyFor(projectId));
}

