from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ModelRoute:
    task_type: str
    primary: str
    fallback: Optional[str] = None
    provider: Optional[str] = None
    api_base: Optional[str] = None

    @property
    def model(self) -> str:
        return self.primary


class ModelRouter:
    """Central model selection for design and trend AI calls.

    Configuration order:
    1. MODEL_ROUTES_JSON, e.g. {"design_chat":{"primary":"gpt-5.5","fallback":"deepseek-v4-pro"}}
    2. MODEL_<TASK>_PRIMARY / MODEL_<TASK>_FALLBACK environment variables
    3. Backward-compatible env vars already used by this project
    4. Hardcoded safe defaults
    """

    def __init__(self, env: Optional[dict[str, str]] = None) -> None:
        self.env = env if env is not None else os.environ
        self._json_routes = self._load_json_routes()

    def text_model(self, task_type: str = "design_chat") -> ModelRoute:
        return self.route(
            task_type,
            default_primary=self.env.get("AMUX_TEXT_MODEL", "gemini-3-pro-preview"),
            default_fallback=self.env.get("AMUX_TEXT_FALLBACK_MODEL") or self.env.get("MODEL_DESIGN_CHAT_FALLBACK"),
        )

    def vision_model(self, task_type: str = "vision_tagging") -> ModelRoute:
        return self.route(
            task_type,
            default_primary=(
                self.env.get("AMUX_VISION_MODEL")
                or self.env.get("AMUX_TEXT_MODEL")
                or "gemini-3-pro-preview"
            ),
            default_fallback=self.env.get("AMUX_VISION_FALLBACK_MODEL"),
        )

    def image_model(self, task_type: str = "image_generation") -> ModelRoute:
        return self.route(
            task_type,
            default_primary=self.env.get("AMUX_IMAGE_MODEL", "gpt-image-2"),
            default_fallback=self.env.get("AMUX_IMAGE_FALLBACK_MODEL"),
        )

    def image_edit_model(self, task_type: str = "image_edit") -> ModelRoute:
        return self.route(
            task_type,
            default_primary=(
                self.env.get("AMUX_IMAGE_EDIT_MODEL")
                or self.env.get("AMUX_IMAGE_MODEL")
                or "gpt-image-2"
            ),
            default_fallback=self.env.get("AMUX_IMAGE_EDIT_FALLBACK_MODEL"),
        )

    def tryon_model(self, task_type: str = "virtual_tryon") -> ModelRoute:
        return self.route(
            task_type,
            default_primary=(
                self.env.get("AMUX_TRYON_MODEL")
                or self.env.get("AMUX_IMAGE_MODEL")
                or "gpt-image-2"
            ),
            default_fallback=self.env.get("AMUX_TRYON_FALLBACK_MODEL"),
        )

    def trend_model(self, task_type: str = "trend_analysis") -> ModelRoute:
        route = self.route(
            task_type,
            default_primary=self.env.get("LLM_MODEL", ""),
            default_fallback=self.env.get("LLM_FALLBACK_MODEL"),
            default_provider=self.env.get("LLM_PROVIDER", ""),
            default_api_base=self.env.get("LLM_BASE_URL", ""),
        )
        return route

    def fallback_model(self, failed_model: str) -> Optional[str]:
        if not failed_model:
            return None
        for route in self._all_routes():
            if route.primary == failed_model and route.fallback:
                return route.fallback
        env_key = f"MODEL_FALLBACK_FOR_{self._env_task_name(failed_model)}"
        return self.env.get(env_key)

    def route(
        self,
        task_type: str,
        *,
        default_primary: str = "",
        default_fallback: Optional[str] = None,
        default_provider: Optional[str] = None,
        default_api_base: Optional[str] = None,
    ) -> ModelRoute:
        cfg = self._json_routes.get(task_type, {})
        task_key = self._env_task_name(task_type)

        primary = (
            str(cfg.get("primary") or "").strip()
            or self.env.get(f"MODEL_{task_key}_PRIMARY", "").strip()
            or default_primary
        )
        fallback = (
            str(cfg.get("fallback") or "").strip()
            or self.env.get(f"MODEL_{task_key}_FALLBACK", "").strip()
            or (default_fallback or "")
        )
        provider = (
            str(cfg.get("provider") or "").strip()
            or self.env.get(f"MODEL_{task_key}_PROVIDER", "").strip()
            or (default_provider or "")
        )
        api_base = (
            str(cfg.get("api_base") or "").strip()
            or self.env.get(f"MODEL_{task_key}_API_BASE", "").strip()
            or (default_api_base or "")
        )
        return ModelRoute(
            task_type=task_type,
            primary=primary,
            fallback=fallback or None,
            provider=provider or None,
            api_base=api_base or None,
        )

    def litellm_model_id(self, route: ModelRoute) -> str:
        model = route.primary
        provider = (route.provider or "").lower()
        return self._litellm_model_id(provider, model)

    def litellm_fallback_model_id(self, route: ModelRoute) -> Optional[str]:
        if not route.fallback:
            return None
        provider = (route.provider or "").lower()
        return self._litellm_model_id(provider, route.fallback)

    def _load_json_routes(self) -> dict[str, dict[str, Any]]:
        raw = self.env.get("MODEL_ROUTES_JSON", "").strip()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(k): v for k, v in data.items() if isinstance(v, dict)}

    def _all_routes(self) -> list[ModelRoute]:
        routes = []
        for task_type, cfg in self._json_routes.items():
            if isinstance(cfg, dict) and cfg.get("primary"):
                routes.append(
                    ModelRoute(
                        task_type=task_type,
                        primary=str(cfg.get("primary") or ""),
                        fallback=str(cfg.get("fallback") or "") or None,
                        provider=str(cfg.get("provider") or "") or None,
                    )
                )
        return routes

    @staticmethod
    def _env_task_name(value: str) -> str:
        return "".join(ch if ch.isalnum() else "_" for ch in value.upper()).strip("_")

    @staticmethod
    def _litellm_model_id(provider: str, model: str) -> str:
        if not model:
            return model
        if provider == "openai":
            return model if "/" in model else f"openai/{model}"
        if provider == "anthropic":
            return model if "/" in model else f"anthropic/{model}"
        if provider == "deepseek":
            return model if "/" in model else f"deepseek/{model}"
        if provider == "local":
            return model if "/" in model else f"ollama/{model}"
        return model


model_router = ModelRouter()
