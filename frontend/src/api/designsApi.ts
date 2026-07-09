// API helpers for projects and designs
const BASE = '/api/design';

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('af:session-expired'));
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Projects ────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  brief: string;
  instructions: string;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface DesignThread {
  id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchProjects(token: string, search = ''): Promise<Project[]> {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await fetch(`${BASE}/projects${q}`, { headers: authHeader(token) });
  const data = await handle<{ projects: Project[] }>(res);
  return data.projects;
}

export async function fetchProject(token: string, projectId: string): Promise<{ project: Project; designs: DesignThread[] }> {
  const res = await fetch(`${BASE}/projects/${projectId}`, { headers: authHeader(token) });
  return handle<{ project: Project; designs: DesignThread[] }>(res);
}

export async function createProject(token: string, name: string, description = ''): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ name, description }),
  });
  const data = await handle<{ project: Project }>(res);
  return data.project;
}

export async function patchProject(
  token: string,
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'brief' | 'instructions' | 'starred'>>,
): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${projectId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(patch),
  });
  const data = await handle<{ project: Project }>(res);
  return data.project;
}

export async function deleteProject(token: string, projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
  await handle<unknown>(res);
}

// ── Designs ─────────────────────────────────────────────────

export async function fetchDesigns(token: string, projectId?: string | null): Promise<DesignThread[]> {
  const q = projectId != null ? `?project_id=${projectId}` : '';
  const res = await fetch(`${BASE}/designs${q}`, { headers: authHeader(token) });
  const data = await handle<{ designs: DesignThread[] }>(res);
  return data.designs;
}

export async function createDesign(token: string, opts: { title?: string; projectId?: string }): Promise<DesignThread> {
  const res = await fetch(`${BASE}/designs`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: opts.title || '', project_id: opts.projectId || null }),
  });
  const data = await handle<{ design: DesignThread }>(res);
  return data.design;
}
