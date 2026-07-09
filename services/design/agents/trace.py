from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from .base import ToolTrace


class JsonlToolTraceStore:
    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def append(self, trace: ToolTrace) -> None:
        line = json.dumps(trace.to_dict(), ensure_ascii=False, default=str)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
