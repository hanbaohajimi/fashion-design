/**
 * Shared types for the personalization system.
 */

export interface InferredKeyword {
  tag: string;
  confidence: number;
  count: number;
  evidence?: string;
}

export interface PersonalStatic {
  body_shape?: '苹果型' | '梨型' | '沙漏型' | '直筒型' | '倒三角型';
  height_cm?: number;
  concerns?: string[];
  style_keywords?: string[];
  avoid_elements?: string[];
  occasions?: string[];
  color_palette?: string[];
  budget_tier?: '亲民' | '中端' | '中高端' | '奢侈';
  size?: { top?: string; bottom?: string };
}

export interface PersonalDynamic {
  inferred_keywords: InferredKeyword[];
  disliked_elements: string[];
  color_tendency: string[];
  last_analyzed_at?: string;
  sessions_analyzed: number;
}

export interface PersonalProfile {
  static?: PersonalStatic;
  dynamic?: PersonalDynamic;
  meta?: { onboarding_completed: boolean; updated_at: string };
  pending_review?: PendingReview;
}

export interface DesignerProject {
  id: string;
  name: string;
  status: 'active' | 'archived';
  created_at: string;
  brief: {
    season?: string;
    target_audience?: string;
    occasions?: string[];
    style_anchors?: string[];
    reference_designers?: string[];
    mood_keywords?: string[];
    avoid_directions?: string[];
  };
  design_language: {
    silhouettes?: string[];
    fabric_preferences?: string[];
    structural_details?: string[];
    color_system?: string[];
    craft_preferences?: string[];
  };
  dynamic: {
    design_signatures: Array<{ pattern: string; confidence: number; evidence: string }>;
    recurring_elements: string[];
    last_analyzed_at?: string;
    sessions_analyzed: number;
  };
  pending_review?: PendingReview;
}

export interface DesignerWorkspace {
  active_project_id: string | null;
  projects: DesignerProject[];
  meta?: { onboarding_completed: boolean; updated_at: string };
}

export interface PendingReview {
  type: 'personal' | 'designer';
  result: Record<string, unknown>;
  generated_at: string;
}

export type SessionMode = 'personal' | 'designer';
