from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional


@dataclass
class ToolContext:
    session: Any
    session_id: str
    tool_call_id: str
    model_name: str
    trace_dir: str


@dataclass
class ToolTrace:
    id: str
    session_id: str
    tool_call_id: str
    tool_name: str
    input_args: dict[str, Any]
    model_name: str
    input_images: list[str]
    output_images: list[str]
    latency_ms: int
    cost: Optional[dict[str, Any]]
    error: Optional[str]
    output: dict[str, Any]
    created_at: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BaseTool:
    name: str = ""
    description: str = ""
    input_schema: dict[str, Any] = {}
    output_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "status": {"type": "string"},
            "file_path": {"type": "string"},
            "url": {"type": "string"},
            "id": {"type": "string"},
            "message": {"type": "string"},
            "workflow_hint": {"type": "string"},
        },
    }
    parallel_safe: bool = False

    def __init__(
        self,
        runner: Callable[[Any, dict[str, Any]], dict[str, Any]],
        *,
        model_name: str,
    ) -> None:
        self._runner = runner
        self._model_name = model_name

    def openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }

    def model_name_for(self, _args: dict[str, Any], context: ToolContext) -> str:
        return self._model_name or context.model_name

    async def run(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        return await asyncio.to_thread(self._runner, context.session, args)

    async def execute(
        self,
        args: dict[str, Any],
        context: ToolContext,
        recorder: Callable[[ToolTrace], None],
    ) -> dict[str, Any]:
        trace_id = uuid.uuid4().hex
        started = time.perf_counter()
        created_at = datetime.now(timezone.utc).isoformat()
        input_images = self.collect_input_images(args, context)
        output: dict[str, Any] = {}
        error: Optional[str] = None

        try:
            output = await self.run(args, context)
            if output.get("status") == "error":
                error = str(output.get("message") or "tool returned error")
            return output
        except Exception as exc:
            error = str(exc)
            output = {"status": "error", "message": error}
            return output
        finally:
            latency_ms = int((time.perf_counter() - started) * 1000)
            trace = ToolTrace(
                id=trace_id,
                session_id=context.session_id,
                tool_call_id=context.tool_call_id,
                tool_name=self.name,
                input_args=dict(args),
                model_name=self.model_name_for(args, context),
                input_images=input_images,
                output_images=self.collect_output_images(output, context),
                latency_ms=latency_ms,
                cost=None,
                error=error,
                output=output,
                created_at=created_at,
                metadata={
                    "mode": getattr(context.session, "mode", None),
                    "designer_project_id": getattr(context.session, "designer_project_id", None),
                    "user_email": getattr(context.session, "user_email", None),
                },
            )
            recorder(trace)

    def collect_input_images(self, args: dict[str, Any], context: ToolContext) -> list[str]:
        paths: list[str] = []
        for key in ("base_image_path", "target_dress_path", "pattern_ref_path", "dress_path", "model_path"):
            value = args.get(key)
            if isinstance(value, str) and value.strip():
                paths.append(value)

        session = context.session
        for attr in ("current_image_path", "current_model_path", "current_tryon_path"):
            value = getattr(session, attr, None)
            if isinstance(value, str) and value.strip():
                paths.append(value)

        seen: set[str] = set()
        result: list[str] = []
        for path in paths:
            if path not in seen:
                seen.add(path)
                result.append(path)
        return result

    def collect_output_images(self, output: dict[str, Any], _context: ToolContext) -> list[str]:
        images: list[str] = []
        for key in ("file_path", "url"):
            value = output.get(key)
            if isinstance(value, str) and value.strip():
                images.append(value)
        return images
