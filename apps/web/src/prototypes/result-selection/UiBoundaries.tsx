"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Notice } from "../../components/ui";
import { ProjectGrid } from "../../modules/projects/ProjectGrid";
import type { Project } from "../../modules/projects/project-types";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import { BomTable, PomTable } from "../../modules/studio/TechPackTables";
import {
  serializeTechPackDraft,
  validateTechPack,
} from "../../modules/studio/tech-pack-draft";
import {
  boundaryFabrics,
  boundaryProjects,
  boundaryTechPack,
} from "./boundary-fixtures";
import { FIXTURE_LABELS, type FixtureMode } from "./fixtures";
import styles from "./prototype.module.css";

export function UiBoundaries() {
  const [mode, setMode] = useState<FixtureMode>("demo");
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>真实组件的数据边界</h1>
          <p>全部操作只改变本地演示状态，图片为示意图。</p>
        </div>
        <Link href="/prototypes/result-selection">返回结果挑选原型</Link>
      </header>
      <div className={styles.harness}>
        <label>
          数据{" "}
          <select
            value={mode}
            aria-label="边界数据"
            onChange={(event) => setMode(event.target.value as FixtureMode)}
          >
            {Object.entries(FIXTURE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <BoundaryStage key={mode} mode={mode} />
    </main>
  );
}
function BoundaryStage({ mode }: { readonly mode: FixtureMode }) {
  const [projects, setProjects] = useState(() => boundaryProjects(mode));
  const [fabrics] = useState(() => boundaryFabrics(mode));
  const [draft, setDraft] = useState(() => boundaryTechPack(mode));
  const [notice, setNotice] = useState("");
  const remove = async (project: Project) => {
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setNotice("已从本地演示中移除，未更改真实项目。");
  };
  return (
    <>
      {notice ? <Notice onClose={() => setNotice("")}>{notice}</Notice> : null}
      <section
        className={styles.boundarySection}
        onClickCapture={(event) => {
          if (
            (event.target as HTMLElement).closest(
              'a[href^="/fixture-project-"]',
            )
          ) {
            event.preventDefault();
            setNotice(
              "这是演示项目，可通过项目操作菜单测试重命名、复制与归档。",
            );
          }
        }}
      >
        <h2>项目卡片 · {projects.length} 项</h2>
        {projects.length ? (
          <ProjectGrid
            projects={projects}
            duplicatingProjectIds={new Set()}
            onArchive={remove}
            onDelete={remove}
            onRestore={async () => setNotice("演示项目已恢复")}
            onRename={async (project, name) =>
              setProjects((current) =>
                current.map((item) =>
                  item.id === project.id ? { ...item, name } : item,
                ),
              )
            }
            onDuplicate={async (project) =>
              setProjects((current) => [
                ...current,
                { ...project, id: `fixture-project-${crypto.randomUUID()}` },
              ])
            }
          />
        ) : (
          <p>没有项目。</p>
        )}
      </section>
      <section className={styles.boundarySection}>
        <h2>面料卡片 · {fabrics.length} 项</h2>
        {fabrics.length ? (
          <FabricVirtualGrid
            fabrics={fabrics}
            height={480}
            onAdd={(fabric) =>
              setNotice(`已选择演示面料 ${fabric.id}，未写入画布。`)
            }
          />
        ) : (
          <p>没有面料。</p>
        )}
      </section>
      <section className={styles.boundarySection}>
        <h2>技术包 · 字符串草稿</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              validateTechPack(serializeTechPackDraft(draft));
              setNotice("草稿校验通过，未写入服务端。");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "校验失败");
            }
          }}
        >
          <BomTable
            rows={draft.bom}
            disabled={false}
            onChange={(bom) =>
              setDraft((current) => ({
                ...current,
                bom,
                reviewConfirmed: false,
              }))
            }
          />
          <PomTable
            rows={draft.pom}
            disabled={false}
            onChange={(pom) =>
              setDraft((current) => ({
                ...current,
                pom,
                reviewConfirmed: false,
              }))
            }
          />
          <Button type="submit">仅校验草稿</Button>
        </form>
      </section>
    </>
  );
}
