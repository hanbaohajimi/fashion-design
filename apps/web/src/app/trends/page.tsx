import { AppHeader } from "../../components/AppHeader";
import controls from "../../components/ui.module.css";

import { resolveTrendReturnTarget } from "../../modules/trends/active-board";
import { TrendArchive } from "../../modules/trends/TrendArchive";
import styles from "../../modules/trends/trends.module.css";

const TREND_PLATFORMS = [
  { name: "WGSN", url: "https://www.wgsn.com/en/products/fashion-design" },
  { name: "POP Fashion", url: "https://www.popfashioninfo.com/" },
  { name: "Future Snoops", url: "https://www.futuresnoops.com/" },
  {
    name: "Trendstop",
    url: "https://www.trendstop.com/fashion-trend-forecasting/",
  },
  { name: "Heuritech", url: "https://heuritech.com/" },
  { name: "Vogue Runway", url: "https://www.vogue.com/fashion-shows" },
  { name: "Tagwalk", url: "https://www.tag-walk.com/en/" },
  { name: "Pinterest Trends", url: "https://trends.pinterest.com/" },
] as const;

interface TrendsPageProps {
  readonly searchParams: Promise<{
    readonly boardId?: string | readonly string[];
    readonly from?: string | readonly string[];
  }>;
}

function firstSearchValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export default async function TrendsPage({ searchParams }: TrendsPageProps) {
  const query = await searchParams;
  const source = firstSearchValue(query.from);
  const boardId = firstSearchValue(query.boardId);
  const returnParams = new URLSearchParams();
  if (source) returnParams.set("from", source);
  if (boardId) returnParams.set("boardId", boardId);
  const returnTo = `/trends${returnParams.toString() ? `?${returnParams.toString()}` : ""}`;
  resolveTrendReturnTarget(source, boardId);

  return (
    <>
      <AppHeader
        current="discover"
        projectId={source === "board" ? boardId : undefined}
      />
      <main className={`${styles.discoverPage} ${controls.controlSurface}`}>
        <div className={styles.editorialFrame}>
          <section className={styles.discoverHero} data-workspace-heading>
            <h1>发现</h1>
            <p className={styles.discoverHeroLead}>
              汇聚时尚趋势、关键来源与行业参考，帮你更快找到设计方向。
            </p>
          </section>

          <TrendArchive
            returnTo={returnTo}
            projectId={source === "board" ? boardId : undefined}
          />

          <aside className={styles.externalSourcesSidebar}>
            <h2 className={styles.externalSourcesTitle}>外部来源</h2>
            <nav aria-label="时尚趋势平台" className={styles.externalSourcesList}>
              {TREND_PLATFORMS.map((platform) => (
                <a
                  className={styles.externalSourceItem}
                  href={platform.url}
                  key={platform.name}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className={styles.sourceName}>{platform.name}</span>
                  <span aria-hidden="true" className={styles.externalArrow}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M3 13 13 3M5 3h8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </a>
              ))}
            </nav>
          </aside>
        </div>
      </main>
    </>
  );
}
