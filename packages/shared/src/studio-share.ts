import { z } from "zod";

const id = z.string().trim().min(1).max(128);
export const studioShareTargetSchema = z.enum(["STYLE", "TECH_PACK"]);
export const studioShareCreateSchema = z
  .object({
    targetType: studioShareTargetSchema,
    revisionId: id,
  })
  .strict();
export const studioPublicReviewInputSchema = z
  .object({
    kind: z.enum(["decision", "comment"]).default("decision"),
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]).optional(),
    reviewerName: z.string().trim().max(80).default(""),
    text: z.string().trim().min(1).max(2_000),
    assetId: id.optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "decision" && !value.decision)
      context.addIssue({ code: "custom", path: ["decision"], message: "审批必须选择决定" });
    if ((value.x !== undefined || value.y !== undefined) && (!value.assetId || value.x === undefined || value.y === undefined))
      context.addIssue({ code: "custom", path: ["assetId"], message: "定位意见必须指定图片和完整坐标" });
  });

export interface StudioShareAssetView {
  readonly assetId: string;
  readonly height: number | null;
  readonly kind: "front" | "back" | "detail";
  readonly label: string;
  readonly reviewed: boolean;
  readonly thumbnailUrl: string | null;
  readonly url: string;
  readonly width: number | null;
}
export interface StudioShareReviewView {
  readonly createdAt: string;
  readonly decision: "APPROVED" | "CHANGES_REQUESTED";
  readonly name: string;
  readonly text: string;
}
export interface StudioShareCommentView {
  readonly createdAt: string;
  readonly name: string;
  readonly text: string;
}
export interface StudioPublicShareView {
  readonly expiresAt: string;
  readonly projectName: string;
  readonly reviews: readonly StudioShareReviewView[];
  readonly comments: readonly StudioShareCommentView[];
  readonly targetType: "STYLE" | "TECH_PACK";
  readonly title: string;
  readonly revision: number;
  readonly status: string;
  readonly code: string | null;
  readonly styleRevisionId: string | null;
  readonly views: readonly StudioShareAssetView[];
}
export type StudioShareCreateInput = z.infer<typeof studioShareCreateSchema>;
export type StudioPublicReviewInput = z.infer<typeof studioPublicReviewInputSchema>;

