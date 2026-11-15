import type {
  AssistantCanvasEnvelope,
  AssistantCanvasResult,
} from "@fashion/shared";
import { actionShapeIds, canvasRecordObject } from "./canvas-action-context";

export function canvasResultTargets(
  envelope: AssistantCanvasEnvelope,
  records: Record<string, Record<string, unknown>>,
): AssistantCanvasResult["targets"] {
  return actionShapeIds(envelope.action).map((id) => {
    const observed = envelope.observation.objects.find(
      (item) => item.id === id,
    );
    const record = records[id],
      props = canvasRecordObject(record?.props);
    const type = record?.type ?? observed?.type;
    const kind: AssistantCanvasResult["targets"][number]["kind"] =
      type === "fashion-image" || type === "image"
        ? "image"
        : type === "fashion-creation"
          ? "creation"
          : type === "fashion-swatch"
            ? "swatch"
            : type === "fashion-fabric"
              ? "fabric"
              : type === "group"
                ? "group"
                : "object";
    const title =
      typeof props.title === "string" && props.title.trim()
        ? props.title
        : observed?.title;
    return {
      id,
      title: title && title !== type ? title.slice(0, 200) : "",
      kind,
    };
  });
}
