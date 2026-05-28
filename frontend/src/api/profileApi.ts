/**
 * API helpers for the personalization system.
 * All requests go through the Vite proxy: /api/design/* → localhost:8001/api/*
 */
import type {
  PersonalProfile,
  DesignerWorkspace,
  DesignerProject,
  PersonalStatic,
  LibraryItem,
  LibraryCollection,
  LibraryStats,
  OutfitSuggestion,
  Trend,
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

// ── Library ───────────────────────────────────────────────

export interface LibraryListParams {
  mode?: string;
  project_id?: string;
  collection_id?: string;
  is_favorite?: boolean;
  tags?: string;
  page?: number;
  limit?: number;
}

export async function fetchLibraryItems(
  token: string,
  params: LibraryListParams = {},
): Promise<{ items: LibraryItem[]; total: number; page: number; has_more: boolean }> {
  const q = new URLSearchParams();
  if (params.mode) q.set('mode', params.mode);
  if (params.project_id) q.set('project_id', params.project_id);
  if (params.collection_id) q.set('collection_id', params.collection_id);
  if (params.is_favorite != null) q.set('is_favorite', String(params.is_favorite));
  if (params.tags) q.set('tags', params.tags);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await fetch(`${BASE}/library?${q}`, { headers: authHeader(token) });
  return handle(res);
}

export async function patchLibraryItem(
  token: string,
  itemId: string,
  patch: { is_favorite?: boolean; user_tags?: string[]; notes?: string; save_context?: string },
): Promise<{ item: LibraryItem }> {
  const res = await fetch(`${BASE}/library/${itemId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, ...patch }),
  });
  return handle(res);
}

export async function deleteLibraryItem(token: string, itemId: string): Promise<void> {
  await fetch(`${BASE}/library/${itemId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function fetchLibraryStats(token: string): Promise<LibraryStats> {
  const res = await fetch(`${BASE}/library/stats`, { headers: authHeader(token) });
  return handle(res);
}

export async function fetchSimilarItems(token: string, itemId: string): Promise<{ items: LibraryItem[] }> {
  const res = await fetch(`${BASE}/library/${itemId}/similar`, { headers: authHeader(token) });
  return handle(res);
}

export async function triggerLibraryAnalyze(token: string): Promise<void> {
  await fetch(`${BASE}/library/analyze`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token }),
  });
}

export async function suggestOutfit(
  token: string,
  occasion?: string,
  weather?: { temp: number; condition: string },
): Promise<{ outfits: OutfitSuggestion[]; message?: string }> {
  const res = await fetch(`${BASE}/library/suggest-outfit`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, occasion, weather }),
  });
  return handle(res);
}

// ── Collections ───────────────────────────────────────────

export async function fetchCollections(token: string): Promise<{ collections: LibraryCollection[] }> {
  const res = await fetch(`${BASE}/library/collections`, { headers: authHeader(token) });
  return handle(res);
}

export async function createCollection(
  token: string,
  name: string,
  mode?: string,
  designerProjectId?: string,
): Promise<{ collection: LibraryCollection }> {
  const res = await fetch(`${BASE}/library/collections`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, name, mode, designer_project_id: designerProjectId }),
  });
  return handle(res);
}

export async function patchCollection(
  token: string,
  colId: string,
  patch: { name?: string; cover_item_id?: string; sort_order?: number },
): Promise<{ collection: LibraryCollection }> {
  const res = await fetch(`${BASE}/library/collections/${colId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, ...patch }),
  });
  return handle(res);
}

export async function deleteCollection(token: string, colId: string): Promise<void> {
  await fetch(`${BASE}/library/collections/${colId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function addItemsToCollection(
  token: string,
  colId: string,
  itemIds: string[],
): Promise<void> {
  await fetch(`${BASE}/library/collections/${colId}/items`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, item_ids: itemIds }),
  });
}

export async function removeItemFromCollection(
  token: string,
  colId: string,
  itemId: string,
): Promise<void> {
  await fetch(`${BASE}/library/collections/${colId}/items/${itemId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

// ── Trends ────────────────────────────────────────────────

export async function fetchTrends(
  token: string,
  params: { season?: string; recommended?: boolean; search?: string } = {},
): Promise<{ trends: Trend[]; season: string }> {
  const q = new URLSearchParams();
  if (params.season) q.set('season', params.season);
  if (params.recommended) q.set('recommended', 'true');
  if (params.search) q.set('search', params.search);
  const res = await fetch(`${BASE}/trends?${q}`, { headers: authHeader(token) });
  return handle(res);
}

export async function fetchTrendSeasons(token: string): Promise<{ seasons: string[] }> {
  const res = await fetch(`${BASE}/trends/seasons`, { headers: authHeader(token) });
  return handle(res);
}

export async function fetchTrendDetail(token: string, trendId: string): Promise<{ trend: Trend }> {
  const res = await fetch(`${BASE}/trends/${trendId}`, { headers: authHeader(token) });
  return handle(res);
}

export async function favoriteTrend(token: string, trendId: string): Promise<void> {
  await fetch(`${BASE}/trends/${trendId}/favorite`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token }),
  });
}

export async function unfavoriteTrend(token: string, trendId: string): Promise<void> {
  await fetch(`${BASE}/trends/${trendId}/favorite`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function syncTrends(token: string): Promise<{ synced: number }> {
  const res = await fetch(`${BASE}/trends/sync`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token }),
  });
  return handle(res);
}

export async function addTrendToProject(
  token: string,
  projectId: string,
  trendId: string,
  alignmentNote?: string,
): Promise<{ workspace: DesignerWorkspace }> {
  const res = await fetch(`${BASE}/profile/designer/projects/${projectId}/trends`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ auth_token: token, trend_id: trendId, alignment_note: alignmentNote }),
  });
  return handle(res);
}

export async function removeTrendFromProject(
  token: string,
  projectId: string,
  trendId: string,
): Promise<{ workspace: DesignerWorkspace }> {
  const res = await fetch(`${BASE}/profile/designer/projects/${projectId}/trends/${trendId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
  return handle(res);
}

export async function createConversationSessionWithTrend(
  token: string,
  mode: 'personal' | 'designer',
  designerProjectId?: string,
  trendId?: string,
  trendEnabled?: boolean,
): Promise<{ session_id: string; mode: string; trend_id?: string; trend_enabled: boolean }> {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      auth_token: token,
      mode,
      designer_project_id: designerProjectId,
      trend_id: trendId,
      trend_enabled: trendEnabled ?? false,
    }),
  });
  return handle(res);
}

