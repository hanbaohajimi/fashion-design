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
  resolveTrendReturnTarget(
    firstSearchValue(query.from),
    firstSearchValue(query.boardId),
  );

  return (
    <><AppHeader current="trends" projectId={firstSearchValue(query.from) === "board" ? firstSearchValue(query.boardId) : undefined} /><main className={`${styles.trendsPage} ${controls.controlSurface}`}>
      <div className={styles.editorialFrame}>


        <section className={styles.hero}>
          <h1>趋势档案</h1>
        </section>

        <TrendArchive
          projectId={
            firstSearchValue(query.from) === "board"
              ? firstSearchValue(query.boardId)
              : undefined
          }
        />

        <details className={styles.externalSources}><summary>外部时尚资料 8 个来源</summary><section className={styles.sourceLayout}>
          <nav aria-label="时尚趋势平台" className={styles.platformIndex}>
            {TREND_PLATFORMS.map((platform, index) => (
              <a
                className={styles.sourceRow}
                href={platform.url}
                key={platform.name}
                rel="noreferrer"
                target="_blank"
              >
                <span className={styles.sourceIndex}>
                  {(index + 1).toString().padStart(2, "0")}
                </span>
                <strong className={styles.sourceName}>{platform.name}</strong>
                <span aria-hidden="true" className={styles.externalArrow}>
                  ↗
                </span>
              </a>
            ))}
          </nav>

        </section></details>
      </div>
    </main></>
  );
}
