from __future__ import annotations

from typing import Any, Callable

from .base import BaseTool


class CallableTool(BaseTool):
    def __init__(
        self,
        *,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        runner: Callable[[Any, dict[str, Any]], dict[str, Any]],
        model_name: str,
        parallel_safe: bool = False,
    ) -> None:
        super().__init__(runner, model_name=model_name)
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.parallel_safe = parallel_safe


class GenerateImageTool(CallableTool):
    pass


class DrawSketchTool(CallableTool):
    pass


class EditImageTool(CallableTool):
    pass


class TransferPatternTool(CallableTool):
    pass


class GenerateModelTool(CallableTool):
    pass


class VirtualTryOnTool(CallableTool):
    pass
