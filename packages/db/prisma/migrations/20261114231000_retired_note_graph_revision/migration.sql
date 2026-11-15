-- Invalidate graph readers after the prior content-retirement migration.
UPDATE workflow_graphs SET revision=revision+1, updated_at=now()
WHERE project_id IN (SELECT project_id FROM workflow_nodes WHERE payload->>'retiredNote'='true');
