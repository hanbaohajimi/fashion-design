import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { BoardElementsController } from "./board-elements/board-elements.controller";
import { BoardElementsService } from "./board-elements/board-elements.service";
import { BoardsController } from "./boards/boards.controller";
import { BoardsService } from "./boards/boards.service";
import { ExportsController } from "./exports/exports.controller";
import { ExportsService } from "./exports/exports.service";
import { FilesController } from "./files/files.controller";
import { FilesService } from "./files/files.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";

describe("tsx 开发模式下的控制器依赖注入", () => {
  it.each([
    [BoardElementsController, BoardElementsService, "boardElementsService"],
    [BoardsController, BoardsService, "boardsService"],
    [ExportsController, ExportsService, "exportsService"],
    [FilesController, FilesService, "filesService"],
    [ProjectsController, ProjectsService, "projectsService"],
  ] as const)("%s 显式注入服务", (Controller, Service, property) => {
    const dependencies =
      (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, Controller) as
        | Array<{ index: number; param: unknown }>
        | undefined) ?? [];

    expect(property).toBeTruthy();
    expect(dependencies).toContainEqual({ index: 0, param: Service });
  });
});
