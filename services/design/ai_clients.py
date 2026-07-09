"""
amux.ai 中转适配层 — OpenAI 兼容接口。

- 图像生成 / 编辑 / 试穿 / 图案迁移:gpt-image-2(走 /v1/images/generations 或 /v1/images/edits)
- Agent 对话 + 视觉:claude-sonnet-4-6(走 /v1/chat/completions,工具调用 OpenAI 风格)
- 趋势分析(LiteLLM 路径)由 services/trend 独立配置,不在此文件

环境变量:AMUX_API_KEY 必须存在,缺失即崩。
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

from openai import OpenAI

_SERVICES_DIR = Path(__file__).resolve().parent.parent
if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

from model_router import model_router

AMUX_API_KEY = os.environ["AMUX_API_KEY"]
AMUX_BASE_URL = os.environ.get("AMUX_BASE_URL", "https://api.amux.ai/v1")

TEXT_MODEL = model_router.text_model("design_chat").model
VISION_MODEL = model_router.vision_model("vision_tagging").model
IMAGE_MODEL = model_router.image_model("image_generation").model
IMAGE_EDIT_MODEL = model_router.image_edit_model("image_edit").model
TRYON_MODEL = model_router.tryon_model("virtual_tryon").model

_client = OpenAI(api_key=AMUX_API_KEY, base_url=AMUX_BASE_URL)

_ASPECT_TO_SIZE = {
    "square": "1024x1024",
    "portrait": "1024x1536",
    "landscape": "1536x1024",
}


# ─────────────────────────────────────────────
# 图像生成 / 编辑 / 试穿(统一一个函数)
# ─────────────────────────────────────────────


def generate_image(
    prompt: str,
    aspect: str = "square",
    reference_paths: Optional[list[str]] = None,
) -> bytes:
    """
    单一图像入口。
    - reference_paths 为空 → /v1/images/generations(纯文生图)
    - 1 张及以上 → /v1/images/edits(支持多图参考:试穿/图案迁移)
    返回 PNG 字节。
    """
    size = _ASPECT_TO_SIZE.get(aspect, _ASPECT_TO_SIZE["square"])

    if not reference_paths:
        resp = _client.images.generate(
            model=IMAGE_MODEL,
            prompt=prompt,
            size=size,
            n=1,
        )
    else:
        model = TRYON_MODEL if len(reference_paths) >= 2 else IMAGE_EDIT_MODEL
        files = [open(p, "rb") for p in reference_paths]
        try:
            resp = _client.images.edit(
                model=model,
                image=files if len(files) > 1 else files[0],
                prompt=prompt,
                size=size,
                n=1,
            )
        finally:
            for f in files:
                try:
                    f.close()
                except Exception:
                    pass

    data = resp.data[0]
    if getattr(data, "b64_json", None):
        return base64.b64decode(data.b64_json)
    if getattr(data, "url", None):
        import urllib.request
        with urllib.request.urlopen(data.url) as r:
            return r.read()
    raise RuntimeError("amux image API returned neither b64_json nor url")


# ─────────────────────────────────────────────
# 视觉理解(单图分析)
# ─────────────────────────────────────────────


def _image_to_data_url(path: str) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lower().lstrip(".") or "png"
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    return f"data:{mime};base64,{b64}"


def vision_analyze(image_path: str, prompt: str) -> str:
    """读一张图 + 一段文字,返回模型文本回复(用于 tag、analyze、enhance)。"""
    resp = _client.chat.completions.create(
        model=VISION_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": _image_to_data_url(image_path)}},
            ],
        }],
    )
    return (resp.choices[0].message.content or "").strip()


# ─────────────────────────────────────────────
# 简单 LLM 调用(无工具,无图)
# ─────────────────────────────────────────────


def simple_chat(messages: list[dict]) -> str:
    """
    messages: [{"role": "system"/"user"/"assistant", "content": "..."}]
    返回纯文本。
    """
    resp = _client.chat.completions.create(
        model=TEXT_MODEL,
        messages=messages,
    )
    return (resp.choices[0].message.content or "").strip()


# ─────────────────────────────────────────────
# Agent 工具调用(OpenAI 风格;Claude via amux.ai 直接兼容)
# ─────────────────────────────────────────────


def chat_with_tools(history: list[dict], openai_tools: Optional[list[dict]] = None) -> dict:
    """
    返回 {"role": "assistant", "content": str, "tool_calls": [{"id","type","function":{"name","arguments"}}]}
    history 中的 tool_call_id 必须与上一轮 assistant 的 tool_calls[].id 对齐。
    """
    kwargs: dict[str, Any] = {
        "model": TEXT_MODEL,
        "messages": history,
    }
    if openai_tools:
        kwargs["tools"] = openai_tools

    resp = _client.chat.completions.create(**kwargs)
    msg = resp.choices[0].message

    tool_calls: list[dict] = []
    for tc in (msg.tool_calls or []):
        tool_calls.append({
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments or "{}",
            },
        })

    return {
        "role": "assistant",
        "content": msg.content or "",
        "tool_calls": tool_calls,
    }
