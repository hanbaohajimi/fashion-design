import { ProjectCard } from "./ProjectCard";
import type { Project } from "./project-types";
import styles from "./projects.module.css";
import { useProjectGridMotion } from "./use-project-grid-motion";

interface ProjectGridProps {
  readonly duplicatingProjectIds: ReadonlySet<string>;
  readonly onArchive: (project: Project) => Promise<void>;
  readonly onDelete: (project: Project) => Promise<void>;
  readonly onDuplicate: (project: Project) => Promise<void>;
  readonly onRename: (project: Project, name: string) => Promise<void>;
  readonly onRestore: (project: Project) => Promise<void>;
  readonly projects: readonly Project[];
  readonly busy?: boolean;
}

export function ProjectGrid({
  duplicatingProjectIds,
  onArchive,
  onDelete,
  onDuplicate,
  onRename,
  onRestore,
  projects,
  busy,
}: ProjectGridProps) {
  const root = useProjectGridMotion(projects);
  return (
    <section ref={root} aria-label="项目列表" aria-busy={busy || undefined} className={styles.projectGrid} style={{ position: "relative" }}>
      {projects.map((project, index) => (
        <ProjectCard
          duplicating={duplicatingProjectIds.has(project.id)}
          index={index}
          key={project.id}
          onArchive={onArchive}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onRename={onRename}
          onRestore={onRestore}
          project={project}
        />
      ))}
    </section>
  );
}
