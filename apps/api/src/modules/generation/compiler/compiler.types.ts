export type SemanticImageChannel =
  | "fabric"
  | "pattern"
  | "detail"
  | "avoid";

export interface ImageReference {
  readonly elementId: string;
  readonly imageUrl: string;
  readonly labels: readonly string[];
}

export interface SilhouetteReference {
  readonly elementId: string;
  readonly edgeImageUrl: string;
}

export interface CompiledGenInput {
  readonly version: 1;
  readonly mode: "text_only" | "board_guided";
  readonly positivePrompt: string;
  readonly negativePrompt: string;
  readonly palette: readonly string[];
  readonly styleReferences: readonly ImageReference[];
  readonly silhouetteReferences: readonly SilhouetteReference[];
  readonly fabricReferences: readonly ImageReference[];
  readonly patternReferences: readonly ImageReference[];
  readonly detailReferences: readonly ImageReference[];
  readonly avoidLabels: readonly string[];
  readonly notes: readonly string[];
  readonly enhancement: "llm" | "keywords";
}

export interface SemanticImageInput {
  readonly channel: SemanticImageChannel;
  readonly imageUrl: string;
}

export interface PromptEnhancementInput {
  readonly userRequest: string;
  readonly keywordPositive: string;
  readonly keywordNegative: string;
  readonly palette: readonly string[];
  readonly fabricTerms: readonly string[];
  readonly patternTerms: readonly string[];
  readonly detailTerms: readonly string[];
  readonly avoidTerms: readonly string[];
  readonly notes: readonly string[];
}

export interface PromptEnhancement {
  readonly positivePrompt: string;
  readonly negativePrompt: string;
}

export interface ContextModelGateway {
  analyzeImage(input: SemanticImageInput): Promise<readonly string[]>;
  enhancePrompt(input: PromptEnhancementInput): Promise<PromptEnhancement>;
}

