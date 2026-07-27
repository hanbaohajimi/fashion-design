-- CreateTable
CREATE TABLE "board_snapshots" (
    "project_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_snapshots_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "board_elements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "shape_id" TEXT NOT NULL,
    "shape_type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "record" JSONB,
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_elements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_elements_project_id_shape_id_key"
ON "board_elements"("project_id", "shape_id");

-- CreateIndex
CREATE INDEX "board_elements_project_id_deleted_at_idx"
ON "board_elements"("project_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "board_snapshots"
ADD CONSTRAINT "board_snapshots_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_elements"
ADD CONSTRAINT "board_elements_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
