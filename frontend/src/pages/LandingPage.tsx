import { ArrowRight } from 'lucide-react';

interface LandingPageProps {
  onEnter: () => void;
}

const TOC: ReadonlyArray<{ no: string; title: string; em?: string; meta: string }> = [
  { no: '01', title: 'Design Studio', em: 'L\u2019Atelier', meta: 'Generate · Edit · Compose' },
  { no: '02', title: 'Try-On', em: 'La Pose', meta: 'Model · Garment · Scene' },
  { no: '03', title: 'Wardrobe', em: 'La Garde-Robe', meta: 'Catalogue · Outfits · Memory' },
  { no: '04', title: 'Trends', em: 'L\u2019Air du Temps', meta: 'Discovery · Analysis · Briefs' },
];

function todayLabel(): string {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export default function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <div className="entry-shell">
      <div className="entry-frame">
        <div className="entry-panel cover-hero">
          <section className="hero-copy">
            <div className="kicker-rule">AI Fashion &middot; Issue No. 01</div>

            <h1 className="headline headline-xl" style={{ marginTop: 28 }}>
              From inspiration
              <br />
              <em style={{ fontStyle: 'italic', color: 'var(--color-ink-3)' }}>to atelier.</em>
            </h1>

            <p className="lede" style={{ marginTop: 28, maxWidth: '34rem' }}>
              一个统一的工作台，把灵感、趋势、项目与生成连接起来。
              进入后，你将在更克制的版式与更纯粹的工具之间，
              完成从洞察到创作的整条链路。
            </p>

            <div className="hero-actions">
              <button type="button" onClick={onEnter} className="btn-primary px-5">
                进入工作台
                <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" className="btn-secondary px-5">
                查看工作流
              </button>
            </div>

            <div className="cover-hero-meta" style={{ marginTop: 36 }}>
              <span>Vol. I</span>
              <span className="rule-vertical" />
              <span>{todayLabel()}</span>
              <span className="rule-vertical" />
              <span>Atelier Mono</span>
            </div>
          </section>

          <aside style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <p className="kicker" style={{ marginBottom: 14 }}>In this issue</p>
            <div className="cover-toc">
              {TOC.map(item => (
                <a
                  key={item.no}
                  className="cover-toc-row"
                  onClick={onEnter}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onEnter(); }}
                >
                  <span className="cover-toc-numeral">{item.no}</span>
                  <span className="cover-toc-title">
                    {item.title}
                    {item.em && (
                      <>
                        {' '}
                        <em>/ {item.em}</em>
                      </>
                    )}
                  </span>
                  <span className="cover-toc-meta">{item.meta}</span>
                </a>
              ))}
            </div>
            <p className="dek" style={{ marginTop: 20, fontSize: 12, color: 'var(--color-ink-3)' }}>
              四个工作区，一种语言。点选任意一项进入工作台。
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
