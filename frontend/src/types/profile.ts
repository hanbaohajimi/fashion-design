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

// ── Library ──────────────────────────────────────────────

export interface AutoTags {
  garment_types?: string[];
  colors?: string[];
  silhouette?: string;
  occasions?: string[];
  style_keywords?: string[];
  season?: string;
}

export interface LibraryItem {
  id: string;
  user_email: string;
  image_url: string;
  session_id?: string;
  generation_prompt?: string;
  mode: 'personal' | 'designer';
  designer_project_id?: string;
  img_type?: string;
  auto_tags: AutoTags;
  tag_status: 'pending' | 'completed' | 'failed';
  user_tags: string[];
  is_favorite: boolean;
  notes?: string;
  save_context: string;
  created_at: string;
}

export interface LibraryCollection {
  id: string;
  user_email: string;
  name: string;
  cover_item_id?: string;
  cover_image?: string;
  is_smart: boolean;
  smart_rule?: string;
  mode?: string;
  designer_project_id?: string;
  sort_order: number;
  item_count: number;
  created_at: string;
}

export interface LibraryStats {
  total_count: number;
  favorite_count: number;
  top_colors: Array<{ name: string; count: number }>;
  top_styles: Array<{ name: string; count: number }>;
  top_occasions: Array<{ name: string; count: number }>;
  top_silhouettes: Array<{ name: string; count: number }>;
  mode_distribution: { personal: number; designer: number };
}

export interface OutfitSuggestion {
  description: string;
  items: LibraryItem[];
  tags: string[];
}

// ── Wardrobe ──────────────────────────────────────────────

export type WardrobeCategory = 'top' | 'bottom' | 'suit' | 'shoes' | 'bag' | 'jewelry' | 'accessory' | 'uncategorized';
export type WardrobeSourceType = 'trend' | 'design' | 'upload';

export interface WardrobeItem {
  id: string;
  user_email: string;
  name: string;
  category: WardrobeCategory;
  sub_category?: string;
  colors: string[];
  style_tags: string[];
  season?: string;
  fabric?: string;
  image_url: string;
  thumbnail_url?: string;
  source_type: WardrobeSourceType;
  source_label: string;
  source_ref?: string;
  source_image_url?: string;
  ai_analysis: Record<string, unknown>;
  ai_status: 'pending' | 'completed' | 'failed';
  notes?: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface Outfit {
  id: string;
  user_email: string;
  name: string;
  description?: string;
  occasion?: string;
  season?: string;
  style?: string;
  cover_image_url?: string;
  items: WardrobeItem[];
  created_at: string;
  updated_at: string;
}

export interface WardrobeStats {
  total: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
}

// ── Trends ────────────────────────────────────────────────

export interface TrendColorPalette {
  name: string;
  hex: string;
}

export interface TrendDesignLanguage {
  silhouettes?: string[];
  fabrics?: string[];
  details?: string[];
  style_prompt?: string;
}

export interface TrendAnchor {
  trend_id: string;
  trend_name: string;
  alignment_note?: string;
  added_at: string;
}

export interface Trend {
  id: string;
  name: string;
  name_zh?: string;
  season?: string;
  status: string;
  cover_image?: string;
  image_gallery: string[];
  keywords: string[];
  description?: string;
  color_palette: TrendColorPalette[];
  design_language: TrendDesignLanguage;
  style_tags: string[];
  occasion_tags: string[];
  sort_order: number;
  updated_at: string;
  // client-side additions
  match_score?: number | null;
  is_favorite?: boolean;
}
