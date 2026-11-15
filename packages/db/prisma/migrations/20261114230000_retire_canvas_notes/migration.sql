-- Retire sticky-note content. Business records formerly projected as notes
-- retain their identity and placement and use a plain text surface.
CREATE TEMP TABLE retired_note_shapes (project_id text, shape_id text, node_id text);

CREATE FUNCTION canvas_note_records(doc jsonb) RETURNS SETOF jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(doc #> '{document,store}')='object' THEN doc #> '{document,store}' ELSE '{}'::jsonb END)
  UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(doc->'store')='object' THEN doc->'store' ELSE '{}'::jsonb END)
  UNION ALL SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(doc->'legacyRecords')='array' THEN doc->'legacyRecords' ELSE '[]'::jsonb END)
$$;

INSERT INTO retired_note_shapes
SELECT DISTINCT source.project_id, source.shape_id, n.id
FROM (
  SELECT project_id, record->>'id' AS shape_id, record #>> '{meta,canvasNodeId}' AS node_id
  FROM (SELECT project_id,snapshot FROM canvas_documents UNION ALL SELECT project_id,snapshot FROM board_snapshots) d,
       LATERAL canvas_note_records(d.snapshot) record
  WHERE record->>'typeName'='shape' AND record->>'type' IN ('fashion-note','note')
  UNION ALL SELECT project_id,shape_id,record #>> '{meta,canvasNodeId}' FROM board_elements WHERE shape_type IN ('fashion-note','note')
) source
LEFT JOIN canvas_object_bindings b ON b.project_id=source.project_id AND b.shape_id=source.shape_id
LEFT JOIN workflow_nodes n ON n.project_id=source.project_id AND n.id=COALESCE(b.node_id,source.node_id)
WHERE n.id IS NULL OR n.type='reference_text' OR n.payload->>'retiredNote'='true';

UPDATE workflow_nodes SET type='legacy', title='已删除便签',
  payload='{"retiredNote":true,"canvasPlacement":"manual"}'::jsonb, updated_at=now()
WHERE id IN (SELECT node_id FROM retired_note_shapes WHERE node_id IS NOT NULL);
UPDATE workflow_node_versions SET type='legacy', title='已删除便签',
  payload='{"retiredNote":true,"canvasPlacement":"manual"}'::jsonb
WHERE node_id IN (SELECT node_id FROM retired_note_shapes WHERE node_id IS NOT NULL);
UPDATE canvas_object_bindings SET removed_at=now()
WHERE (project_id,shape_id) IN (SELECT project_id,shape_id FROM retired_note_shapes);

CREATE FUNCTION retire_canvas_note_document(doc jsonb, project text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; child jsonb; item record; asset record;
BEGIN
  IF jsonb_typeof(doc)='object' THEN
    IF doc->>'typeName'='shape' AND doc->>'type' IN ('fashion-note','note') THEN
      IF EXISTS(SELECT 1 FROM retired_note_shapes r WHERE r.project_id=project AND r.shape_id=doc->>'id') THEN RETURN NULL; END IF;
      SELECT n.title,n.payload INTO asset FROM workflow_nodes n
      LEFT JOIN canvas_object_bindings b ON b.project_id=project AND b.shape_id=doc->>'id'
      WHERE n.project_id=project AND n.id=COALESCE(b.node_id,doc #>> '{meta,canvasNodeId}') LIMIT 1;
      RETURN jsonb_set(jsonb_set(doc,'{type}','"fashion-text"'::jsonb),'{props}',jsonb_build_object(
        'w',COALESCE(doc #> '{props,w}','280'::jsonb), 'h',COALESCE(doc #> '{props,h}','220'::jsonb),
        'text',COALESCE(asset.payload->>'text',asset.payload->>'summary',doc #>> '{props,text}',asset.title,''),
        'title',COALESCE(asset.title,'文本')));
    END IF;
    IF doc->>'typeName'='binding' AND EXISTS(SELECT 1 FROM retired_note_shapes r WHERE r.project_id=project AND r.shape_id IN (doc->>'fromId',doc->>'toId')) THEN RETURN NULL; END IF;
    IF doc ? 'payload' AND EXISTS(SELECT 1 FROM retired_note_shapes r WHERE r.project_id=project AND r.node_id=doc->>'id') THEN
      RETURN doc || '{"type":"legacy","title":"已删除便签","payload":{"retiredNote":true,"canvasPlacement":"manual"}}'::jsonb;
    END IF;
    result='{}'::jsonb;
    FOR item IN SELECT key,value FROM jsonb_each(doc) LOOP
      child=retire_canvas_note_document(item.value,project);
      IF child IS NOT NULL THEN result=result || jsonb_build_object(item.key,child); END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(doc)='array' THEN
    result='[]'::jsonb;
    FOR child IN SELECT value FROM jsonb_array_elements(doc) LOOP
      child=retire_canvas_note_document(child,project);
      IF child IS NOT NULL THEN result=result || jsonb_build_array(child); END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN doc;
END $$;

UPDATE canvas_documents SET snapshot=retire_canvas_note_document(snapshot,project_id),revision=revision+1,format_version=2,updated_at=now();
UPDATE board_snapshots SET snapshot=retire_canvas_note_document(snapshot,project_id),revision=revision+1,updated_at=now();
UPDATE board_elements SET record=NULL,deleted_at=now(),updated_at=now()
WHERE (project_id,shape_id) IN (SELECT project_id,shape_id FROM retired_note_shapes);
UPDATE board_elements SET record=retire_canvas_note_document(record,project_id),shape_type='fashion-text',updated_at=now()
WHERE shape_type IN ('fashion-note','note') AND record IS NOT NULL;
UPDATE canvas_mutations SET result=retire_canvas_note_document(result,project_id);

DROP FUNCTION retire_canvas_note_document(jsonb,text);
DROP FUNCTION canvas_note_records(jsonb);
DROP TABLE retired_note_shapes;
