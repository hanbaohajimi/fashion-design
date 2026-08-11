export type SemanticImageChannel =
  | "fabric"
  | "pattern"
  | "detail"
  | "palette"
  | "avoid";

export interface ImageReference {
  readonly elementId: string;
  readonly imageUrl: string;
  readonly labels: readonly string[];
}

export interface FabricReference extends ImageReference {
  readonly fabricId: string;
  readonly role: "fabric_texture";
  readonly weight: number;
}

export interface TrendReference extends ImageReference {
  readonly role: "style_ref";
  readonly trendItemId: string;
  readonly weight: number;
}

export interface FabricGenerationInput {
  readonly attributes: unknown;
  readonly boardElementId: string;
  readonly fabricId: string;
  readonly role: "fabric_texture";
  readonly weight: number;
}

export interface CompilerBoardElement {
  readonly id: string;
  readonly record: unknown;
  readonly role: string;
  readonly shapeType: string;
}

export interface CompileResult {
  readonly prompt: string;
  readonly refImages: readonly (FabricReference | TrendReference)[];
  readonly fabricInputs?: readonly FabricGenerationInput[];
}

export interface CompilerChannel {
  compile(elements: readonly CompilerBoardElement[]): Promise<CompileResult>;
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
  readonly paletteReferences: readonly ImageReference[];
  readonly styleReferences: readonly (ImageReference | TrendReference)[];
  readonly silhouetteReferences: readonly SilhouetteReference[];
  readonly fabricReferences: readonly (FabricReference | ImageReference)[];
  readonly fabricInputs: readonly FabricGenerationInput[];
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
