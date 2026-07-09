from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .base import BaseTool, ToolContext, ToolTrace
from .trace import JsonlToolTraceStore


class ToolRegistry:
    def __init__(self, tools: Iterable[BaseTool], trace_store: JsonlToolTraceStore) -> None:
        self._tools = {tool.name: tool for tool in tools}
        self._trace_store = trace_store

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def openai_tools(self) -> list[dict[str, Any]]:
        return [tool.openai_tool() for tool in self._tools.values()]

    def is_parallel_safe(self, name: str) -> bool:
        tool = self.get(name)
        return bool(tool and tool.parallel_safe)

    async def run(
        self,
        name: str,
        args: dict[str, Any],
        context: ToolContext,
    ) -> dict[str, Any]:
        tool = self.get(name)
        if not tool:
            return {"status": "error", "message": f"未知工具: {name}"}
        return await tool.execute(args, context, self.record)

    async def replay(
        self,
        trace: ToolTrace | dict[str, Any],
        context: ToolContext,
    ) -> dict[str, Any]:
        payload = trace.to_dict() if isinstance(trace, ToolTrace) else trace
        name = str(payload.get("tool_name") or "")
        args = payload.get("input_args") or {}
        if not isinstance(args, dict):
            return {"status": "error", "message": "trace input_args must be an object"}
        return await self.run(name, args, context)

    def record(self, trace: ToolTrace) -> None:
        self._trace_store.append(trace)

    @property
    def trace_path(self) -> Path:
        return self._trace_store.path
