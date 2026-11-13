import { Skeleton, SkeletonGroup } from "./ui";
import studioStyles from "../modules/studio/studio.module.css";
import reviewStyles from "../modules/studio-shares/review-share.module.css";
import shareStyles from "../modules/board/workflow/image-workspace.module.css";

export function StudioRouteLoading() {
  return (
    <main className={studioStyles.shell} aria-label="正在加载工作室">
      <div className={studioStyles.workspaceMain}>
        <div className={studioStyles.presentationModes}>
          <Skeleton label="正在加载工作室导航" className={studioStyles.skeleton} />
        </div>
        <div className={studioStyles.body}>
          <SkeletonGroup className={studioStyles.section}>
            <Skeleton label="正在加载工作室资料" className={studioStyles.skeleton} />
            <Skeleton label="正在加载款式与修订" className={studioStyles.skeleton} />
          </SkeletonGroup>
        </div>
      </div>
    </main>
  );
}

export function ReviewRouteLoading() {
  return (
    <main className={reviewStyles.page} aria-label="正在打开只读评审">
      <header className={reviewStyles.header}>
        <div className={reviewStyles.brand}>
          <strong>森织</strong>
          <span>只读评审</span>
        </div>
        <Skeleton label="正在读取评审状态" />
      </header>
      <div className={reviewStyles.content}>
        <div className={reviewStyles.titleBlock}>
          <Skeleton label="正在读取评审标题" />
          <Skeleton label="正在读取评审信息" />
        </div>
        <div className={reviewStyles.columns}>
          <section className={reviewStyles.visualSection}>
            <div className={reviewStyles.imageFrame}>
              <Skeleton label="正在读取评审图片" />
            </div>
          </section>
          <aside className={reviewStyles.reviewAside}>
            <Skeleton label="正在读取评审记录" />
            <Skeleton label="正在读取反馈入口" />
          </aside>
        </div>
      </div>
    </main>
  );
}

export function ShareRouteLoading() {
  return (
    <main className={shareStyles.workspace} aria-label="正在打开分享图片">
      <header className={shareStyles.topbar}>
        <strong>森织 · 只读分享</strong>
        <Skeleton label="正在读取分享状态" />
      </header>
      <div className={shareStyles.sharedArtwork}>
        <Skeleton label="正在加载分享的设计" className={shareStyles.sharedSkeleton} />
      </div>
    </main>
  );
}
