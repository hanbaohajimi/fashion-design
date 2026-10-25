"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PrototypeIcon, type IconName } from "./PrototypeIcon";
import {
  assetUrl,
  candidates,
  chapters,
  createTrial,
  directions,
  isDirty,
  materials,
  projects,
  type Chapter,
  type Direction,
  type Scenario,
  type Screen,
  type Trial,
} from "./prototype-data";
import styles from "./comparison.module.css";

interface Context {
  direction: Direction;
  trial: Trial;
  scenario: Scenario;
  update: (patch: Partial<Trial>, action?: string) => void;
  navigate: (screen: Screen) => void;
  openProject: (id: string) => void;
  setScenario: (scenario: Scenario) => void;
  prepare: () => void;
  generate: () => void;
  saveStyle: () => void;
  savePack: () => void;
  download: () => void;
}

function Action({
  children,
  onClick,
  primary = false,
  disabled = false,
  icon,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: IconName;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={primary ? styles.primary : styles.button}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {icon && <PrototypeIcon name={icon} />}
      {children}
    </button>
  );
}

function Garment({
  image,
  alt,
  broken = false,
  className = "",
}: {
  image: string;
  alt: string;
  broken?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`${styles.garment} ${className}`}>
      {broken || failed ? (
        <div className={styles.imageFailure}>
          <PrototypeIcon name="image" />
          <span>图片暂不可用</span>
          <small>方案资料仍可查看</small>
          {failed && !broken && (
            <button type="button" onClick={() => setFailed(false)}>
              重新加载图片
            </button>
          )}
        </div>
      ) : (
        // Local prototype assets preserve the full garment silhouette.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetUrl(image)}
          alt={alt}
          width="1024"
          height="1024"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function Brand() {
  return (
    <span className={styles.brand}>
      <span className={styles.brandMark}>a</span>
      <span>
        Atelier<span className={styles.brandDetail}>设计工作室</span>
      </span>
    </span>
  );
}

function ScreenNav({
  ctx,
  vertical = false,
}: {
  ctx: Context;
  vertical?: boolean;
}) {
  const entries: { id: Screen; label: string; icon: IconName }[] = [
    { id: "projects", label: "项目", icon: "grid" },
    { id: "workbench", label: "设计工作台", icon: "image" },
    { id: "tech", label: "技术包", icon: "file" },
  ];
  return (
    <nav
      className={vertical ? styles.verticalNav : styles.screenNav}
      aria-label="原型应用导航"
    >
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-current={ctx.trial.screen === entry.id ? "page" : undefined}
          onClick={() => ctx.navigate(entry.id)}
        >
          <PrototypeIcon name={entry.icon} />
          <span>{entry.label}</span>
          {vertical && ctx.trial.screen === entry.id && (
            <PrototypeIcon name="chevron" />
          )}
        </button>
      ))}
    </nav>
  );
}

function ProjectContext({ ctx }: { ctx: Context }) {
  const project =
    projects.find((item) => item.id === ctx.trial.projectId) ?? projects[0];
  return (
    <label className={styles.projectContext}>
      <span>当前项目</span>
      <select
        aria-label="切换当前项目"
        value={ctx.trial.projectId}
        onChange={(event) => ctx.openProject(event.target.value)}
      >
        {projects.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <small>{project.season}</small>
    </label>
  );
}

function StatePanel({ ctx }: { ctx: Context }) {
  if (ctx.scenario === "loading")
    return (
      <div className={styles.statePanel} aria-busy="true">
        <h2>正在加载项目资料</h2>
        <p>作品、参考素材与已保存的修订即将显示。</p>
        <div className={styles.skeletons} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <Action onClick={() => ctx.setScenario("normal")}>结束加载演示</Action>
      </div>
    );
  return (
    <div className={styles.statePanel} role="alert">
      <PrototypeIcon name="file" />
      <h2>暂时无法读取项目</h2>
      <p>模拟连接中断。已经输入的内容仍保留，重试后继续。</p>
      <Action primary onClick={() => ctx.setScenario("normal")}>
        重试加载
      </Action>
    </div>
  );
}

function ProjectsView({ ctx }: { ctx: Context }) {
  const [query, setQuery] = useState("");
  const list =
    ctx.scenario === "empty"
      ? []
      : projects.filter((project) => project.name.includes(query.trim()));
  return (
    <section className={styles.projectPage} aria-label="项目入口">
      <header className={styles.pageHeading}>
        <div>
          <h1>
            {ctx.direction === "relay"
              ? "今天，从这里继续"
              : ctx.direction === "gallery"
                ? "你的作品集"
                : "项目档案"}
          </h1>
          <p>把想法留下，让下一步更清楚。</p>
        </div>
        <span className={styles.quiet}>3 个模拟项目</span>
      </header>
      <div className={styles.projectTools}>
        <label className={styles.search}>
          <PrototypeIcon name="search" />
          <input
            aria-label="搜索项目"
            value={query}
            placeholder="搜索项目名称"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>最近更新优先</span>
      </div>
      {list.length ? (
        <div className={styles.projectList}>
          {list.map((project, index) => (
            <article className={styles.project} key={project.id}>
              <button
                type="button"
                className={styles.projectImage}
                onClick={() => ctx.openProject(project.id)}
                aria-label={`打开${project.name}`}
              >
                {project.image ? (
                  <Garment
                    image={project.image}
                    alt={`${project.name}的服装方案`}
                    broken={ctx.scenario === "image-error"}
                  />
                ) : (
                  <div className={styles.newProject}>
                    <PrototypeIcon name="plus" />
                    <span>从一个想法开始</span>
                  </div>
                )}
              </button>
              <div className={styles.projectInfo}>
                <span className={styles.projectMeta}>
                  {project.season}
                  <span>{project.stage}</span>
                </span>
                <h2>
                  <button
                    type="button"
                    onClick={() => ctx.openProject(project.id)}
                  >
                    {ctx.scenario === "long"
                      ? `${project.name} · 面向跨城市出行与日常办公场景的轻量化层搭探索及细节修改记录`
                      : project.name}
                  </button>
                </h2>
                <p>{project.summary}</p>
                <span className={styles.quiet}>{project.count}</span>
                <div className={styles.projectFoot}>
                  <span>{project.updated}</span>
                  <Action
                    primary={index === 0}
                    icon="arrow"
                    onClick={() => ctx.openProject(project.id)}
                  >
                    {project.id === "new" ? "开始设计" : "继续设计"}
                  </Action>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <h2>{query ? "没有匹配的项目" : "给下一个想法一个位置"}</h2>
          <p>
            {query
              ? "换一个关键词，或清空搜索查看全部项目。"
              : "从描述需求开始，素材和服装方案会随着创作逐步积累。"}
          </p>
          <Action
            primary
            onClick={() => {
              if (query) setQuery("");
              else {
                ctx.setScenario("normal");
                ctx.openProject("new");
              }
            }}
          >
            {query ? "清空搜索" : "打开空白项目"}
          </Action>
        </div>
      )}
      <footer className={styles.pageNote}>
        示例项目与状态仅用于比较设计，不会创建或修改正式项目。
      </footer>
    </section>
  );
}

function MaterialShelf({
  ctx,
  onReference,
}: {
  ctx: Context;
  onReference?: () => void;
}) {
  return (
    <section className={styles.materialShelf} aria-label="参考素材">
      <div className={styles.sectionHeading}>
        <h3>参考素材</h3>
        <span>3 项</span>
      </div>
      {materials.map((material) => (
        <div className={styles.material} key={material.id}>
          <span
            className={styles.swatch}
            style={{ backgroundColor: material.color }}
          />
          <div>
            <strong>{material.name}</strong>
            <small>{material.detail}</small>
          </div>
          <button
            type="button"
            aria-pressed={ctx.trial.references.includes(material.id)}
            aria-label={`${ctx.trial.references.includes(material.id) ? "移除" : "引用"}${material.name}`}
            disabled={ctx.scenario === "readonly"}
            onClick={() => {
              ctx.update(
                {
                  references: ctx.trial.references.includes(material.id)
                    ? ctx.trial.references.filter((id) => id !== material.id)
                    : [...ctx.trial.references, material.id],
                  proposal: false,
                },
                `引用切换：${material.name}`,
              );
              if (!ctx.trial.references.includes(material.id)) onReference?.();
            }}
          >
            <PrototypeIcon
              name={
                ctx.trial.references.includes(material.id) ? "check" : "plus"
              }
            />
          </button>
        </div>
      ))}
    </section>
  );
}

function Assistant({ ctx }: { ctx: Context }) {
  const candidate =
    candidates.find((item) => item.id === ctx.trial.candidateId) ??
    candidates[0];
  const readOnly = ctx.scenario === "readonly";
  return (
    <section className={styles.assistant} aria-label="设计助手">
      <div className={styles.sectionHeading}>
        <h3>
          <PrototypeIcon name="chat" />
          设计助手
        </h3>
        <span>模拟</span>
      </div>
      <div className={styles.assistantContext}>
        <span>正在围绕</span>
        <strong>{candidate.name}</strong>
        <small>修改时保留母图与来源</small>
      </div>
      <p className={styles.assistantHint}>
        描述你想调整的细节，以及要保留的部分。确认修改计划后再生成。
      </p>
      {ctx.trial.references.length > 0 && (
        <div className={styles.referenceTags}>
          {ctx.trial.references.map((id) => (
            <span key={id}>
              {materials.find((item) => item.id === id)?.name}
              <button
                type="button"
                aria-label={`取消引用${materials.find((item) => item.id === id)?.name}`}
                disabled={readOnly}
                onClick={() =>
                  ctx.update(
                    {
                      references: ctx.trial.references.filter(
                        (item) => item !== id,
                      ),
                      proposal: false,
                    },
                    "移除引用",
                  )
                }
              >
                <PrototypeIcon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.prompt}>
        <label htmlFor={`prompt-${ctx.direction}-${ctx.trial.projectId}`}>
          修改要求
        </label>
        <textarea
          id={`prompt-${ctx.direction}-${ctx.trial.projectId}`}
          value={ctx.trial.prompt}
          rows={3}
          placeholder="例如：收窄袖口，保留翻领、双排扣与整体长度。"
          disabled={readOnly || ctx.trial.running}
          onChange={(event) =>
            ctx.update({ prompt: event.target.value, proposal: false })
          }
        />
      </div>
      {ctx.trial.proposal ? (
        <div className={styles.proposal}>
          <strong>请确认本次修改</strong>
          <p>{ctx.trial.prompt}</p>
          <small>
            {ctx.trial.references.length} 项素材已引用 · 基于{candidate.name}
          </small>
          <Action
            primary
            disabled={readOnly || ctx.trial.running}
            onClick={ctx.generate}
          >
            {ctx.trial.running ? "正在生成模拟结果…" : "确认并模拟生成"}
          </Action>
          <button
            type="button"
            className={styles.textButton}
            disabled={ctx.trial.running}
            onClick={() => ctx.update({ proposal: false }, "返回修改要求")}
          >
            返回调整要求
          </button>
        </div>
      ) : (
        <Action
          primary
          disabled={readOnly || !ctx.trial.prompt.trim()}
          onClick={ctx.prepare}
        >
          整理修改计划
          <PrototypeIcon name="arrow" />
        </Action>
      )}
      {ctx.trial.generated && (
        <p className={styles.success}>
          <PrototypeIcon name="check" />
          模拟结果已加入方案列表，可选择后继续。
        </p>
      )}
      {readOnly && (
        <p className={styles.quiet}>
          只读模式：可查看方案和资料，不能生成或保存。
        </p>
      )}
    </section>
  );
}

function CandidateCard({
  ctx,
  candidate,
}: {
  ctx: Context;
  candidate: (typeof candidates)[number];
}) {
  const selected = ctx.trial.candidateId === candidate.id;
  return (
    <article className={styles.candidate} data-selected={selected}>
      <button
        type="button"
        className={styles.candidateImage}
        onClick={() =>
          ctx.update(
            { candidateId: candidate.id, proposal: false },
            `选择方案：${candidate.name}`,
          )
        }
        aria-pressed={selected}
        aria-label={`选择${candidate.name}`}
      >
        <Garment
          image={candidate.image}
          alt={candidate.name}
          broken={ctx.scenario === "image-error"}
        />
        <span className={styles.selectionMark}>
          <PrototypeIcon name={selected ? "check" : "plus"} />
          {selected ? "当前方案" : "选择方案"}
        </span>
      </button>
      <div className={styles.candidateCaption}>
        <div>
          <h3>{candidate.name}</h3>
          <p>{candidate.detail}</p>
        </div>
        <span>{candidate.revision}</span>
      </div>
      {ctx.trial.compare && (
        <p className={styles.compareNote}>{candidate.difference}</p>
      )}
    </article>
  );
}

function WorkbenchView({ ctx }: { ctx: Context }) {
  const [mobilePanel, setMobilePanel] = useState("designs");
  const candidate =
    candidates.find((item) => item.id === ctx.trial.candidateId) ??
    candidates[0];
  const empty =
    (ctx.scenario === "empty" || ctx.trial.projectId === "new") &&
    !ctx.trial.generated;
  return (
    <section
      className={styles.workbench}
      aria-label="服装设计工作台"
      data-mobile-panel={mobilePanel}
    >
      <nav className={styles.mobileWorkNav} aria-label="工作台区域">
        {(
          [
            ["designs", "作品"],
            ["materials", "素材"],
            ["assistant", "助手"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mobilePanel === id}
            onClick={() => setMobilePanel(id)}
          >
            {label}
            {id === "assistant" && ctx.trial.references.length > 0 && (
              <span>{ctx.trial.references.length}</span>
            )}
          </button>
        ))}
      </nav>
      <div className={styles.workBody}>
        <header className={styles.pageHeading}>
          <div>
            <h1>
              {ctx.direction === "relay" ? "选定一款，继续推进" : "方案与灵感"}
            </h1>
            <p>
              {empty
                ? "从一份需求开始，建立你的第一组服装方案。"
                : "宽松通勤风衣 · 保留翻领、双排扣与完整廓形"}
            </p>
          </div>
          <span className={styles.status}>
            <span />
            {ctx.trial.running ? "模拟生成中" : "草稿已保留"}
          </span>
        </header>
        {!empty && (
          <div className={styles.selectionBar}>
            <div>
              <span>当前方案</span>
              <strong>{candidate.name}</strong>
              {ctx.trial.savedStyle &&
                ctx.trial.savedCandidateId === candidate.id && (
                  <small>款式 AW26-017 · r{ctx.trial.styleRevision}</small>
                )}
            </div>
            <Action
              primary={!ctx.trial.proposal}
              disabled={ctx.scenario === "readonly" || ctx.trial.running}
              onClick={ctx.saveStyle}
              icon="arrow"
            >
              {ctx.trial.savedStyle &&
              ctx.trial.savedCandidateId === candidate.id
                ? "继续技术包"
                : "保存款式并继续"}
            </Action>
          </div>
        )}
        <div className={styles.workToolbar}>
          <div>
            <strong>{empty ? "还没有方案" : "本组方案"}</strong>
            <span>{empty ? "0" : "2"}</span>
          </div>
          <button
            type="button"
            className={styles.button}
            aria-pressed={ctx.trial.compare}
            onClick={() =>
              ctx.update({ compare: !ctx.trial.compare }, "切换方案比较")
            }
            disabled={empty}
          >
            <PrototypeIcon name="layers" />
            {ctx.trial.compare ? "退出比较" : "并排比较"}
          </button>
        </div>
        {empty ? (
          <div className={styles.empty}>
            <PrototypeIcon name="image" />
            <h2>让第一个想法成形</h2>
            <p>先在设计助手中描述款式，再引用面料或配色。生成前会请你确认。</p>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setMobilePanel("assistant");
                requestAnimationFrame(() => {
                  const field = document.querySelector<HTMLTextAreaElement>(
                    `[data-direction="${ctx.direction}"] textarea`,
                  );
                  field?.focus();
                  field?.scrollIntoView({
                    block: "center",
                    behavior: "instant",
                  });
                });
              }}
            >
              填写设计要求
            </button>
          </div>
        ) : (
          <div
            className={styles.candidateGrid}
            data-compare={ctx.trial.compare}
          >
            {(ctx.direction === "gallery" && !ctx.trial.compare
              ? [candidate]
              : candidates
            ).map((item) => (
              <CandidateCard ctx={ctx} candidate={item} key={item.id} />
            ))}
          </div>
        )}
        {ctx.direction === "gallery" && !empty && (
          <div className={styles.filmstrip} aria-label="方案联系表">
            {candidates.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={ctx.trial.candidateId === item.id}
                onClick={() =>
                  ctx.update(
                    { candidateId: item.id, proposal: false },
                    `选择方案：${item.name}`,
                  )
                }
              >
                <Garment
                  image={item.image}
                  alt=""
                  broken={ctx.scenario === "image-error"}
                />
                <span>
                  {item.name}
                  <small>{item.revision}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <MaterialShelf
          ctx={ctx}
          onReference={() => setMobilePanel("assistant")}
        />
        <details className={styles.notes}>
          <summary>设计说明与来源</summary>
          <p>
            本组方案保留宽松通勤廓形，以藏蓝配色和双排扣为共同约束。袖口修改版来自同一母图。图片与数据为原型演示，实际设计需人工核对。
          </p>
        </details>
      </div>
      <div className={styles.workInspector}>
        <Assistant ctx={ctx} />
      </div>
    </section>
  );
}

function TechView({ ctx }: { ctx: Context }) {
  const candidate =
    candidates.find((item) => item.id === ctx.trial.savedCandidateId) ??
    candidates[0];
  const revision = `r${ctx.trial.styleRevision}`;
  const dirty = isDirty(ctx.trial);
  const readOnly = ctx.scenario === "readonly";
  const edit = (patch: Partial<Trial>) =>
    ctx.update({
      ...patch,
      checked: false,
      published: false,
      exportState: "idle",
    });
  const chapterNav = (
    <nav className={styles.chapterNav} aria-label="技术包章节">
      {chapters.map((chapter) => (
        <button
          type="button"
          key={chapter.id}
          aria-current={ctx.trial.chapter === chapter.id ? "step" : undefined}
          onClick={() =>
            ctx.update({ chapter: chapter.id }, `切换章节：${chapter.label}`)
          }
        >
          {chapter.label}
          {chapter.id === "review" && ctx.trial.published && (
            <PrototypeIcon name="check" />
          )}
        </button>
      ))}
    </nav>
  );
  return (
    <section className={styles.techPage} aria-label="技术包编辑器">
      <header className={styles.pageHeading}>
        <div>
          <h1>技术包</h1>
          <p>
            {ctx.trial.savedStyle
              ? `${candidate.name} · 款式 AW26-017 · ${revision}`
              : "选择款式后建立交付资料"}
          </p>
        </div>
        <span className={styles.status}>
          <span />
          {ctx.trial.published
            ? "已模拟发布"
            : dirty
              ? "有未保存更改"
              : "已保存草稿"}
        </span>
      </header>
      {!ctx.trial.savedStyle ? (
        <div className={styles.empty}>
          <h2>先选定要交付的款式</h2>
          <p>
            技术包需要绑定明确的服装方案与修订。先回到工作台，选择并保存一款。
          </p>
          <Action primary icon="back" onClick={() => ctx.navigate("workbench")}>
            去选择款式
          </Action>
        </div>
      ) : (
        <div className={styles.techLayout}>
          <aside className={styles.techObject}>
            <Garment
              image={candidate.image}
              alt={`技术包当前款式：${candidate.name}`}
              broken={ctx.scenario === "image-error"}
            />
            <strong>{candidate.name}</strong>
            <span>AW26-017 · 修订 {revision}</span>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => ctx.navigate("workbench")}
            >
              返回款式方案
            </button>
            {ctx.direction !== "archive" && chapterNav}
          </aside>
          <div className={styles.techMain}>
            {ctx.direction === "archive" && chapterNav}
            <div className={styles.techForm}>
              {ctx.trial.chapter === "overview" && (
                <>
                  <h2>基本资料</h2>
                  <p>先让同事明确：这份资料对应哪一件作品。</p>
                  <label>
                    技术包名称
                    <input
                      value={ctx.trial.packTitle}
                      disabled={readOnly}
                      maxLength={180}
                      onChange={(event) =>
                        edit({ packTitle: event.target.value })
                      }
                    />
                  </label>
                  <div className={styles.formPair}>
                    <label>
                      款式编号
                      <input readOnly value="AW26-017" />
                    </label>
                    <label>
                      绑定修订
                      <input readOnly value={`${revision} · 当前已保存方案`} />
                    </label>
                  </div>
                  <div className={styles.inlineInfo}>
                    <PrototypeIcon name="file" />
                    <p>
                      保存技术包不会生成图片。发布前需要人工复核；原型中的尺寸和面料信息不能用于生产。
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() =>
                      ctx.update({ chapter: "measurements" }, "继续尺寸章节")
                    }
                  >
                    继续填写尺寸与公差
                    <PrototypeIcon name="arrow" />
                  </button>
                </>
              )}
              {ctx.trial.chapter === "measurements" && (
                <>
                  <h2>尺寸与公差</h2>
                  <p>示例尺寸用于交互测试，须以实际版型测量为准。</p>
                  <div className={styles.formPair}>
                    <label>
                      衣长（cm）
                      <input
                        type="number"
                        min="1"
                        max="250"
                        step="0.1"
                        value={ctx.trial.length}
                        disabled={readOnly}
                        onChange={(event) =>
                          edit({ length: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      允许公差（± cm）
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={ctx.trial.tolerance}
                        disabled={readOnly}
                        onChange={(event) =>
                          edit({ tolerance: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <table className={styles.measureTable}>
                    <caption>当前尺寸摘要 · 模拟数据</caption>
                    <thead>
                      <tr>
                        <th>部位</th>
                        <th>规格</th>
                        <th>公差</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>衣长</th>
                        <td>{ctx.trial.length || "待填写"} cm</td>
                        <td>± {ctx.trial.tolerance || "待填写"} cm</td>
                      </tr>
                      <tr>
                        <th>胸围</th>
                        <td colSpan={2}>待测量，未补造数值</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {ctx.trial.chapter === "materials" && (
                <>
                  <h2>面料与辅料</h2>
                  <p>保持参考信息与生产确认信息的区别。</p>
                  <label>
                    材料备注
                    <textarea
                      rows={6}
                      value={ctx.trial.materialNote}
                      disabled={readOnly}
                      onChange={(event) =>
                        edit({ materialNote: event.target.value })
                      }
                    />
                  </label>
                  <div className={styles.inlineInfo}>
                    <span
                      className={styles.swatch}
                      style={{ backgroundColor: "#263950" }}
                    />
                    <p>
                      藏蓝棉混纺
                      <br />
                      成分、克重、幅宽与供应商待核实。
                    </p>
                  </div>
                </>
              )}
              {ctx.trial.chapter === "review" && (
                <>
                  <h2>复核与交付</h2>
                  <p>确认对象、修订与资料后，再发布这一版。</p>
                  <dl className={styles.reviewList}>
                    <div>
                      <dt>技术包</dt>
                      <dd>{ctx.trial.packTitle}</dd>
                    </div>
                    <div>
                      <dt>绑定款式</dt>
                      <dd>
                        {candidate.name} · {revision}
                      </dd>
                    </div>
                    <div>
                      <dt>衣长 / 公差</dt>
                      <dd>
                        {ctx.trial.length} cm / ± {ctx.trial.tolerance} cm
                      </dd>
                    </div>
                    <div>
                      <dt>材料备注</dt>
                      <dd>{ctx.trial.materialNote || "待补充"}</dd>
                    </div>
                  </dl>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={ctx.trial.checked}
                      disabled={readOnly || dirty}
                      onChange={(event) =>
                        ctx.update(
                          { checked: event.target.checked },
                          "人工确认复核",
                        )
                      }
                    />
                    <span>我已核对本次模拟交付资料</span>
                  </label>
                  {dirty && (
                    <p className={styles.warning}>
                      当前有未保存更改。保存后再进行复核。
                    </p>
                  )}
                  <Action
                    primary
                    disabled={
                      readOnly ||
                      dirty ||
                      !ctx.trial.checked ||
                      ctx.trial.published
                    }
                    onClick={() =>
                      ctx.update(
                        {
                          published: true,
                          exportState: "idle",
                          message: `已模拟发布 ${revision}，原型不会发布正式技术包。`,
                        },
                        "复核并模拟发布",
                      )
                    }
                  >
                    {ctx.trial.published ? "已模拟发布" : "复核并模拟发布"}
                  </Action>
                  {ctx.trial.published && (
                    <div className={styles.exportPanel}>
                      <strong>这一版已准备好</strong>
                      <p>
                        下载包含当前资料的模拟交付单（TXT）。正式产品的 PDF
                        流程保持原有规则。
                      </p>
                      <Action icon="download" onClick={ctx.download}>
                        下载模拟交付单
                      </Action>
                      {ctx.trial.exportState === "ready" && (
                        <small role="status">模拟交付单已下载。</small>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <footer className={styles.saveBar}>
              <span>{dirty ? "更改保留在本次原型中" : "草稿已保存"}</span>
              <Action
                primary
                disabled={readOnly || !dirty}
                onClick={ctx.savePack}
              >
                {dirty ? "保存技术包" : "已保存"}
              </Action>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

function RelayQueue({ ctx }: { ctx: Context }) {
  const steps: {
    screen: Screen;
    title: string;
    description: string;
    complete: boolean;
  }[] = [
    {
      screen: "projects",
      title: "继续项目",
      description: "选择本次工作的设计项目",
      complete: ctx.trial.steps.some((step) => step.startsWith("打开项目")),
    },
    {
      screen: "workbench",
      title: "确认服装方案",
      description: ctx.trial.savedStyle
        ? "款式 AW26-017 已就绪"
        : "比较、修改并选定一款",
      complete: ctx.trial.savedStyle,
    },
    {
      screen: "tech",
      title: "准备交付资料",
      description: ctx.trial.published
        ? "已模拟发布，可以导出"
        : "补充尺寸并人工复核",
      complete: ctx.trial.published,
    },
  ];
  return (
    <aside className={styles.relayQueue}>
      <ProjectContext ctx={ctx} />
      <h2>当前任务</h2>
      <nav aria-label="任务顺序">
        {steps.map((step, index) => (
          <button
            type="button"
            key={step.screen}
            data-active={ctx.trial.screen === step.screen}
            onClick={() => ctx.navigate(step.screen)}
          >
            <span className={styles.stepNumber}>
              {step.complete ? <PrototypeIcon name="check" /> : index + 1}
            </span>
            <span>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
            <PrototypeIcon name="chevron" />
          </button>
        ))}
      </nav>
      <div className={styles.queueNote}>
        <PrototypeIcon name="clock" />
        <p>
          每一步保留当前作品。
          <br />
          随时回到前面查看和修改。
        </p>
      </div>
    </aside>
  );
}

export function ImpeccableComparison() {
  const [direction, setDirection] = useState<Direction>("archive");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [activeProjects, setActiveProjects] = useState<
    Record<Direction, string>
  >({ archive: "commute", gallery: "commute", relay: "commute" });
  const [trials, setTrials] = useState<Record<string, Trial>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [showReviewTools, setShowReviewTools] = useState(false);
  const [chosen, setChosen] = useState<Direction | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const key = `${direction}:${activeProjects[direction]}`;
  const trial = trials[key] ?? createTrial();
  const currentDirection =
    directions.find((item) => item.id === direction) ?? directions[0];

  useEffect(() => () => timerRefs.current.forEach(clearTimeout), []);

  function update(patch: Partial<Trial>, action?: string) {
    setTrials((previous) => {
      const current = previous[key] ?? createTrial();
      return {
        ...previous,
        [key]: {
          ...current,
          ...patch,
          steps: action ? [...current.steps, action] : current.steps,
        },
      };
    });
  }
  function navigate(screen: Screen) {
    update(
      { screen, message: "" },
      `进入${screen === "projects" ? "项目" : screen === "tech" ? "技术包" : "工作台"}`,
    );
  }
  function openProject(id: string) {
    const nextKey = `${direction}:${id}`;
    setActiveProjects((previous) => ({ ...previous, [direction]: id }));
    setTrials((previous) => {
      const current = previous[nextKey] ?? { ...createTrial(), projectId: id };
      return {
        ...previous,
        [nextKey]: {
          ...current,
          projectId: id,
          screen: "workbench",
          steps: [
            ...current.steps,
            `打开项目：${projects.find((item) => item.id === id)?.name}`,
          ],
        },
      };
    });
  }
  function generate() {
    if (
      !trial.prompt.trim() ||
      scenario === "readonly" ||
      trial.running ||
      !trial.proposal
    )
      return;
    update(
      { running: true, message: "正在演示生成状态，不调用模型。" },
      "确认并模拟生成",
    );
    const timer = setTimeout(() => {
      setTrials((previous) => {
        const current = previous[key] ?? createTrial();
        return {
          ...previous,
          [key]: {
            ...current,
            running: false,
            generated: true,
            proposal: false,
            candidateId: "cuff",
            message: "模拟生成完成：复用已有袖口编辑样图，未产生新的模型图像。",
          },
        };
      });
    }, 900);
    timerRefs.current.push(timer);
  }
  function saveStyle() {
    if (scenario === "readonly") return;
    const changed =
      !trial.savedStyle || trial.savedCandidateId !== trial.candidateId;
    update(
      {
        savedStyle: true,
        savedCandidateId: trial.candidateId,
        styleRevision: changed ? trial.styleRevision + 1 : trial.styleRevision,
        checked: changed ? false : trial.checked,
        published: changed ? false : trial.published,
        exportState: changed ? "idle" : trial.exportState,
        screen: "tech",
        message: "款式已模拟保存。当前方案和修订已带入技术包。",
      },
      "保存款式并进入技术包",
    );
  }
  function savePack() {
    if (scenario === "readonly") return;
    const invalidChapter: Chapter | null = !trial.packTitle.trim()
      ? "overview"
      : !trial.length ||
          Number(trial.length) <= 0 ||
          Number(trial.length) > 250 ||
          !trial.tolerance ||
          Number(trial.tolerance) < 0 ||
          Number(trial.tolerance) > 10
        ? "measurements"
        : null;
    if (invalidChapter) {
      update({
        chapter: invalidChapter,
        message:
          invalidChapter === "overview"
            ? "请填写技术包名称。"
            : "请填写有效衣长（1–250 cm）和公差（0–10 cm）。",
      });
      return;
    }
    update(
      {
        savedPack: {
          title: trial.packTitle,
          length: trial.length,
          tolerance: trial.tolerance,
          materialNote: trial.materialNote,
        },
        checked: false,
        published: false,
        message: "技术包草稿已模拟保存，章节切换不会丢失输入。",
      },
      "保存技术包",
    );
  }
  function download() {
    if (!trial.published || isDirty(trial)) return;
    const contents = `Atelier 模拟交付单（非生产文件）\n${trial.packTitle}\n款式 AW26-017 · r${trial.styleRevision}\n方案：${candidates.find((item) => item.id === trial.savedCandidateId)?.name}\n衣长：${trial.length} cm\n公差：±${trial.tolerance} cm\n材料备注：${trial.materialNote}\n所有内容均为交互原型演示。`;
    const url = URL.createObjectURL(
      new Blob([contents], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "Atelier-模拟交付单.txt";
    link.click();
    timerRefs.current.push(setTimeout(() => URL.revokeObjectURL(url), 1000));
    update({ exportState: "ready" }, "下载模拟交付单");
  }
  function reset() {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    setTrials({});
    setScenario("normal");
    setActiveProjects({
      archive: "commute",
      gallery: "commute",
      relay: "commute",
    });
    setChosen(null);
  }
  const ctx: Context = {
    direction,
    trial: { ...trial, projectId: activeProjects[direction] },
    scenario,
    update,
    navigate,
    openProject,
    setScenario,
    prepare: () => {
      if (trial.prompt.trim() && scenario !== "readonly")
        update({ proposal: true }, "整理修改计划");
    },
    generate,
    saveStyle,
    savePack,
    download,
  };
  const content =
    scenario === "loading" || scenario === "error" ? (
      <StatePanel ctx={ctx} />
    ) : trial.screen === "projects" ? (
      <ProjectsView ctx={ctx} />
    ) : trial.screen === "workbench" ? (
      <WorkbenchView ctx={ctx} />
    ) : (
      <TechView ctx={ctx} />
    );

  return (
    <div className={styles.comparison}>
      <header className={styles.reviewBar}>
        <div className={styles.reviewTitle}>
          <strong>设计方案比较</strong>
          <span>交互原型 · 模拟数据</span>
        </div>
        <div
          className={styles.directionTabs}
          role="group"
          aria-label="选择设计方向"
        >
          {directions.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={direction === item.id}
              onClick={() => setDirection(item.id)}
            >
              <b>{item.letter}</b>
              {item.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.mobileReviewToggle}
          aria-expanded={showReviewTools}
          aria-controls="prototype-review-tools"
          onClick={() => setShowReviewTools(!showReviewTools)}
        >
          比较设置
        </button>
        <button
          type="button"
          className={styles.guideButton}
          aria-expanded={showGuide}
          onClick={() => setShowGuide(!showGuide)}
        >
          {showGuide ? "收起比较说明" : "如何比较"}
        </button>
      </header>
      <div
        className={styles.reviewTools}
        id="prototype-review-tools"
        data-expanded={showReviewTools}
      >
        <span>{currentDirection.subtitle}</span>
        <label>
          测试状态
          <select
            aria-label="测试状态"
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Scenario)}
          >
            <option value="normal">正常数据</option>
            <option value="loading">加载中</option>
            <option value="error">请求失败</option>
            <option value="empty">空数据</option>
            <option value="long">长文本</option>
            <option value="image-error">图片失败</option>
            <option value="readonly">只读权限</option>
          </select>
        </label>
        <button type="button" onClick={reset}>
          重置全部试用
        </button>
        <button
          type="button"
          className={styles.chooseButton}
          onClick={() => setChosen(direction)}
        >
          记录偏好
        </button>
      </div>
      {showGuide && (
        <section className={styles.guide}>
          <h2>用同一组任务比较三种结构</h2>
          <p>
            {currentDirection.description} 取舍：{currentDirection.risk}
          </p>
          <ol>
            <li>打开“秋冬通勤系列”，找到当前方案。</li>
            <li>引用藏蓝面料，输入修改要求，确认模拟生成，再选择方案。</li>
            <li>保存为款式，修改技术包尺寸，保存、复核并下载模拟交付单。</li>
          </ol>
          <p>
            每个方向和项目独立保留本次草稿；刷新页面会重置。记录偏好仅显示在本页，不会自动应用到正式平台。
          </p>
        </section>
      )}
      {chosen && (
        <div className={styles.preference} role="status">
          <strong>
            已记录本次偏好：
            {directions.find((item) => item.id === chosen)?.name}
          </strong>
          <span>
            可以继续比较；请在聊天中告诉我最终选择，以开始全平台推广。
          </span>
          <button
            type="button"
            aria-label="关闭偏好提示"
            onClick={() => setChosen(null)}
          >
            <PrototypeIcon name="close" />
          </button>
        </div>
      )}
      <div
        className={styles.surface}
        key={direction}
        data-direction={direction}
        data-screen={trial.screen}
      >
        {direction === "archive" ? (
          <aside className={styles.archiveRail}>
            <Brand />
            <ScreenNav ctx={ctx} vertical />
            <div className={styles.railDivider} />
            {trial.screen !== "projects" && <ProjectContext ctx={ctx} />}
            <div className={styles.railBottom}>
              <span className={styles.avatar}>林</span>
              <span>
                林设计师<small>个人工作区 · 模拟</small>
              </span>
            </div>
          </aside>
        ) : (
          <header className={styles.appTop}>
            <Brand />
            <ScreenNav ctx={ctx} />
            <span className={styles.account}>
              林设计师<span className={styles.avatar}>林</span>
            </span>
          </header>
        )}
        {direction === "relay" && <RelayQueue ctx={ctx} />}
        <main className={styles.appMain}>
          <div className={styles.contextBar}>
            <span>
              {trial.screen === "projects"
                ? "工作区 / 项目"
                : `${projects.find((item) => item.id === activeProjects[direction])?.name} / ${trial.screen === "tech" ? "技术包" : "设计"}`}
            </span>
            <span>{scenario === "readonly" ? "只读访问" : "编辑权限"}</span>
          </div>
          <div
            className={styles.message}
            role="status"
            aria-live="polite"
            data-visible={Boolean(trial.message)}
          >
            {trial.message}
          </div>
          {content}
        </main>
      </div>
      <footer className={styles.trialFooter}>
        <span>当前方向 · {trial.steps.length} 次已记录操作</span>
        <details>
          <summary>查看操作记录</summary>
          <ol>
            {trial.steps.length ? (
              trial.steps.map((step, index) => <li key={index}>{step}</li>)
            ) : (
              <li>开始试用后记录点击，不统计输入字数。</li>
            )}
          </ol>
        </details>
        <span>所有图片、尺寸与状态用于演示</span>
      </footer>
    </div>
  );
}
