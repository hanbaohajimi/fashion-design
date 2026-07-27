import type { Project } from "./project-types";
import { ProjectCard } from "./ProjectCard";
import styles from "./projects.module.css";

interface ProjectGridProps {
  readonly onArchive: (project: Project) => Promise<void>;
  readonly onDelete: (project: Project) => Promise<void>;
  readonly onRename: (project: Project, name: string) => Promise<void>;
  readonly projects: readonly Project[];
}

export function ProjectGrid({
  onArchive,
  onDelete,
  onRename,
  projects,
}: ProjectGridProps) {
  return (
    <section aria-label="项目列表" className={styles.projectGrid}>
      {projects.map((project, index) => (
        <ProjectCard
          index={index}
          key={project.id}
          onArchive={onArchive}
          onDelete={onDelete}
          onRename={onRename}
          project={project}
        />
      ))}
    </section>
  );
}
