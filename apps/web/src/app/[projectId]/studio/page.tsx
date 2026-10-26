import { StudioWorkspace } from "../../../modules/studio/StudioWorkspace";

export default async function StudioPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{
    readonly assetId?: string | string[];
    readonly tab?: string | string[];
    readonly styleRevisionId?: string | string[];
    readonly showId?: string | string[];
    readonly runId?: string | string[];
  }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const assetId = typeof query.assetId === "string" ? query.assetId : undefined;
  return (
    <StudioWorkspace
      key={projectId}
      projectId={projectId}
      initialAssetId={assetId}
      initialStyleRevisionId={typeof query.styleRevisionId === "string" ? query.styleRevisionId : undefined}
      initialTab={typeof query.tab === "string" ? query.tab : undefined}
      initialShowId={typeof query.showId === "string" ? query.showId : undefined}
      initialRunId={typeof query.runId === "string" ? query.runId : undefined}
    />
  );
}
