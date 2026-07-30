import type { Project } from "./project-types";
import { ProjectCard } from "./ProjectCard";
import styles from "./projects.module.css";

interface ProjectGridProps {
  readonly duplicatingProjectIds: ReadonlySet<string>;
  readonly onArchive: (project: Project) => Promise<void>;
  readonly onDelete: (project: Project) => Promise<void>;
  readonly onDuplicate: (project: Project) => Promise<void>;
  readonly onRename: (project: Project, name: string) => Promise<void>;
  readonly onRestore: (project: Project) => Promise<void>;
  readonly projects: readonly Project[];
}

export function ProjectGrid({
  duplicatingProjectIds,
  onArchive,
  onDelete,
  onDuplicate,
  onRename,
  onRestore,
  projects,
}: ProjectGridProps) {
  return (
    <section aria-label="项目列表" className={styles.projectGrid}>
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
