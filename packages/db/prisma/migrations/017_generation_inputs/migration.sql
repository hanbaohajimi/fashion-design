CREATE TABLE "generation_inputs" (
    "id" TEXT NOT NULL,
    "generation_task_id" TEXT NOT NULL,
    "input_type" TEXT NOT NULL DEFAULT 'fabric',
    "fabric_id" TEXT NOT NULL,
    "board_element_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "attributes_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_inputs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "generation_inputs_generation_task_id_board_element_id_fabric_id_key"
ON "generation_inputs"("generation_task_id", "board_element_id", "fabric_id");

CREATE INDEX "generation_inputs_generation_task_id_idx"
ON "generation_inputs"("generation_task_id");

CREATE INDEX "generation_inputs_fabric_id_idx"
ON "generation_inputs"("fabric_id");

ALTER TABLE "generation_inputs"
ADD CONSTRAINT "generation_inputs_generation_task_id_fkey"
FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
