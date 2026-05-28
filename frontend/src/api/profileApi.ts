/**
 * API helpers for the personalization system.
 * All requests go through the Vite proxy: /api/design/* → localhost:8001/api/*
 */
import type {
  PersonalProfile,
  DesignerWorkspace,
  DesignerProject,
  PersonalStatic,
} from '../types/profile';

const BASE = '/api/design';

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Personal Profile ──────────────────────────────────────

export async function fetchPersonalProfile(token: string): Promise<PersonalProfile> {
  const res = await fetch(`${BASE}/profile/personal`, { headers: authHeader(token) });
  const data = await handle<{ profile: PersonalProfile }>(res);
  return data.profile;
}

export async function submitPersonalOnboarding(
  token: string,
  staticData: PersonalStatic,
): Promise<PersonalProfile> {
  const res = await fetch(`${BASE}/profile/personal/onboarding`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, static: staticData }),
  });
  const data = await handle<{ profile: PersonalProfile }>(res);
  return data.profile;
}

export async function triggerPersonalAnalyze(token: string): Promise<PersonalProfile> {
  const res = await fetch(`${BASE}/profile/personal/analyze`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token }),
  });
  const data = await handle<{ profile: PersonalProfile }>(res);
  return data.profile;
}

export async function confirmPersonalReview(
  token: string,
  acceptedItems: unknown[],
): Promise<PersonalProfile> {
  const res = await fetch(`${BASE}/profile/personal/confirm`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, accepted_items: acceptedItems }),
  });
  const data = await handle<{ profile: PersonalProfile }>(res);
  return data.profile;
}

// ── Designer Workspace ────────────────────────────────────

export async function fetchDesignerWorkspace(token: string): Promise<DesignerWorkspace> {
  const res = await fetch(`${BASE}/profile/designer/projects`, { headers: authHeader(token) });
  const data = await handle<{ workspace: DesignerWorkspace }>(res);
  return data.workspace;
}

export async function createDesignerProject(
  token: string,
  payload: { name: string; brief?: object; design_language?: object },
): Promise<{ project: DesignerProject; workspace: DesignerWorkspace }> {
  const res = await fetch(`${BASE}/profile/designer/projects`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, ...payload }),
  });
  return handle<{ project: DesignerProject; workspace: DesignerWorkspace }>(res);
}

export async function patchDesignerProject(
  token: string,
  projectId: string,
  patch: { name?: string; brief?: object; design_language?: object; status?: string },
): Promise<DesignerWorkspace> {
  const res = await fetch(`${BASE}/profile/designer/projects/${projectId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, ...patch }),
  });
  const data = await handle<{ workspace: DesignerWorkspace }>(res);
  return data.workspace;
}

export async function archiveDesignerProject(
  token: string,
  projectId: string,
): Promise<void> {
  await fetch(`${BASE}/profile/designer/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function triggerDesignerAnalyze(
  token: string,
  projectId: string,
): Promise<DesignerWorkspace> {
  const res = await fetch(`${BASE}/profile/designer/projects/${projectId}/analyze`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token }),
  });
  const data = await handle<{ workspace: DesignerWorkspace }>(res);
  return data.workspace;
}

export async function confirmDesignerReview(
  token: string,
  projectId: string,
  acceptedItems: unknown[],
): Promise<DesignerWorkspace> {
  const res = await fetch(`${BASE}/profile/designer/projects/${projectId}/confirm`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, accepted_items: acceptedItems }),
  });
  const data = await handle<{ workspace: DesignerWorkspace }>(res);
  return data.workspace;
}

// ── Conversation Session ──────────────────────────────────

export async function createConversationSession(
  token: string,
  mode: 'personal' | 'designer',
  designerProjectId?: string,
): Promise<{ session_id: string; mode: string; designer_project_id?: string }> {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      auth_token: token,
      mode,
      designer_project_id: designerProjectId,
    }),
  });
  return handle(res);
}
