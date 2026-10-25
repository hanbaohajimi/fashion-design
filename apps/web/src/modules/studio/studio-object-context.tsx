"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { StudioSummary } from "@fashion/shared";
import { ObjectContext } from "../../components/ObjectContext";

const AssetNames = createContext<ReadonlyMap<string, string>>(new Map());

export function studioAssetNames(data: Pick<StudioSummary, "styles">) {
  const names = new Map<string, string>();
  for (const style of data.styles) {
    for (const revision of [style.currentRevision, ...style.revisions]) {
      const source = revision.payload.sourceAssetId;
      if (source && !names.has(source))
        names.set(
          source,
          `${revision.payload.name} · r${revision.revision} · 母图`,
        );
      for (const view of revision.views) {
        if (!names.has(view.assetId))
          names.set(
            view.assetId,
            `${revision.payload.name} · r${revision.revision} · ${view.label || view.kind}`,
          );
      }
    }
  }
  return names;
}

export function StudioAssetNames({
  data,
  children,
}: {
  readonly data: StudioSummary;
  readonly children: ReactNode;
}) {
  const names = useMemo(() => studioAssetNames(data), [data]);
  return <AssetNames.Provider value={names}>{children}</AssetNames.Provider>;
}

export function useStudioAssetName() {
  const names = useContext(AssetNames);
  return (id: string) => names.get(id) ?? `设计图片 · ${id.slice(-8)}`;
}

export function BoundStyleContext({
  data,
  revisionId,
  children,
}: {
  readonly data: StudioSummary;
  readonly revisionId: string;
  readonly children?: ReactNode;
}) {
  const style = data.styles.find(
    (item) =>
      item.currentRevision.id === revisionId ||
      item.revisions.some((revision) => revision.id === revisionId),
  );
  const revision =
    style?.currentRevision.id === revisionId
      ? style.currentRevision
      : style?.revisions.find((item) => item.id === revisionId);
  if (!style || !revision)
    return (
      <ObjectContext name="尚未关联已保存款式" status="选择款式修订后继续" />
    );
  const view = revision.views[0];
  const asset = data.assets.find(
    (item) => item.id === revision.payload.sourceAssetId,
  );
  return (
    <ObjectContext
      name={revision.payload.name}
      code={style.code}
      revision={revision.revision}
      image={
        view?.thumbnailUrl ?? view?.url ?? asset?.thumbnailUrl ?? asset?.url
      }
    >
      {children}
    </ObjectContext>
  );
}

export function techPackStyleRevision(data: StudioSummary, revisionId: string) {
  const revision = data.techPacks
    .flatMap((pack) => [pack.currentRevision, ...pack.revisions])
    .find((item) => item.id === revisionId);
  return revision && "styleRevisionId" in revision.payload
    ? (revision.payload.styleRevisionId ?? "")
    : "";
}
