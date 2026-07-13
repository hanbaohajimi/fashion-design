import { authHeader, handle, BASE } from './http';

// ── Projects ────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  status?: 'active' | 'archived';
  description: string;
  brief: Record<string, unknown>;
  instructions: string;
  design_language?: Record<string, unknown>;
  dynamic?: Record<string, unknown>;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface DesignThread {
  id: string;
  title: string;
  project_id: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface DesignMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: Array<{
    url: string;
    type: string;
    originalUrl?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    sourceUrl?: string;
    originalWidth?: number;
    originalHeight?: number;
    assetId?: string;
    parentAssetId?: string;
    traceId?: string;
    modelName?: string;
    toolName?: string;
  }>;
  created_at: string;
}

export interface ProjectAsset {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  mime_type: string;
  image_url: string | null;
  extracted_text: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CanvasDocument<TState = Record<string, unknown>> {
  state: TState;
  revision: number;
  updated_at: string | null;
}

export interface CanvasRevision {
  id: string;
  design_id: string;
  revision: number;
  label: string | null;
  created_at: string;
}

export interface GenerationAsset {
  id: string;
  design_id: string | null;
  project_id: string | null;
  session_id: string | null;
  parent_asset_id: string | null;
  image_url: string;
  kind: string;
  prompt: string;
  model_name: string;
  tool_name: string;
  trace_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
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

export async function fetchDesign(
  token: string,
  designId: string,
): Promise<{ design: DesignThread; messages: DesignMessage[] }> {
  const res = await fetch(`${BASE}/designs/${designId}`, { headers: authHeader(token) });
  return handle<{ design: DesignThread; messages: DesignMessage[] }>(res);
}

export async function patchDesign(
  token: string,
  designId: string,
  patch: Partial<Pick<DesignThread, 'title' | 'project_id' | 'starred'>>,
): Promise<DesignThread> {
  const res = await fetch(`${BASE}/designs/${designId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(patch),
  });
  const data = await handle<{ design: DesignThread }>(res);
  return data.design;
}

export async function deleteDesign(token: string, designId: string): Promise<void> {
  const res = await fetch(`${BASE}/designs/${designId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
  await handle<unknown>(res);
}

export async function autoTitleDesign(
  token: string,
  designId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/designs/${designId}/auto-title`, {
      method: 'POST',
      headers: authHeader(token),
    });
    const data = await handle<{ title: string | null }>(res);
    return data.title;
  } catch {
    return null;
  }
}

// ── Durable canvas ───────────────────────────────────────────

export async function fetchCanvas<TState = Record<string, unknown>>(
  token: string,
  designId: string,
): Promise<CanvasDocument<TState>> {
  const res = await fetch(`${BASE}/designs/${designId}/canvas`, { headers: authHeader(token) });
  return handle<CanvasDocument<TState>>(res);
}

export async function saveCanvas<TState extends Record<string, unknown>>(
  token: string,
  designId: string,
  state: TState,
  expectedRevision: number,
): Promise<CanvasDocument<TState>> {
  const res = await fetch(`${BASE}/designs/${designId}/canvas`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ state, expected_revision: expectedRevision }),
  });
  if (res.status === 409) {
    throw new Error('409 画布已在其他窗口更新');
  }
  return handle<CanvasDocument<TState>>(res);
}

export async function fetchCanvasRevisions(token: string, designId: string): Promise<CanvasRevision[]> {
  const res = await fetch(`${BASE}/designs/${designId}/canvas/revisions`, { headers: authHeader(token) });
  const data = await handle<{ revisions: CanvasRevision[] }>(res);
  return data.revisions;
}

export async function uploadCanvasAsset(
  token: string,
  designId: string,
  file: File,
): Promise<GenerationAsset> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${BASE}/designs/${designId}/canvas/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const data = await handle<{ asset: GenerationAsset }>(res);
  return data.asset;
}

export async function createCanvasRevision(
  token: string,
  designId: string,
  label = '',
): Promise<CanvasRevision> {
  const res = await fetch(`${BASE}/designs/${designId}/canvas/revisions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ label }),
  });
  const data = await handle<{ revision: CanvasRevision }>(res);
  return data.revision;
}

export async function restoreCanvasRevision<TState = Record<string, unknown>>(
  token: string,
  designId: string,
  revisionId: string,
): Promise<CanvasDocument<TState>> {
  const res = await fetch(`${BASE}/designs/${designId}/canvas/revisions/${revisionId}/restore`, {
    method: 'POST',
    headers: authHeader(token),
  });
  return handle<CanvasDocument<TState>>(res);
}

// ── Project knowledge ────────────────────────────────────────

export async function fetchProjectAssets(token: string, projectId: string): Promise<ProjectAsset[]> {
  const res = await fetch(`${BASE}/projects/${projectId}/assets`, { headers: authHeader(token) });
  const data = await handle<{ assets: ProjectAsset[] }>(res);
  return data.assets;
}

export async function uploadProjectAsset(
  token: string,
  projectId: string,
  file: File,
  kind = 'reference',
): Promise<ProjectAsset> {
  const body = new FormData();
  body.append('file', file);
  body.append('kind', kind);
  const res = await fetch(`${BASE}/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const data = await handle<{ asset: ProjectAsset }>(res);
  return data.asset;
}

export async function patchProjectAsset(
  token: string,
  projectId: string,
  assetId: string,
  patch: Partial<Pick<ProjectAsset, 'name' | 'kind' | 'enabled' | 'extracted_text'>>,
): Promise<ProjectAsset> {
  const res = await fetch(`${BASE}/projects/${projectId}/assets/${assetId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(patch),
  });
  const data = await handle<{ asset: ProjectAsset }>(res);
  return data.asset;
}

export async function deleteProjectAsset(token: string, projectId: string, assetId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}/assets/${assetId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
  await handle<unknown>(res);
}

export async function fetchDesignAssets(token: string, designId: string): Promise<GenerationAsset[]> {
  const res = await fetch(`${BASE}/designs/${designId}/assets`, { headers: authHeader(token) });
  const data = await handle<{ assets: GenerationAsset[] }>(res);
  return data.assets;
}
