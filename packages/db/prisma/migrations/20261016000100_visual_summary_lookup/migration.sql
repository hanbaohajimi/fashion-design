CREATE INDEX "image_visual_summary_source_lookup_idx"
ON "image_visual_summaries"("source_key", "model", "schema_version", "updated_at" DESC);
