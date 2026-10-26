"""Durable stage graph. Business state references private media IDs, never cache paths."""

import copy
import uuid
from pathlib import Path
from typing import TypedDict

from PIL import Image

from .config import Settings
from .contracts import MEDIA_STAGES
from .media import MediaTools, ObjectStorage
from .prompts import STORYBOARD, TRYON, image_prompt
from .providers import ProviderError, Providers


class GraphState(TypedDict):
    runId: str


def pending_input(kind: str, stage: str, media_ids: list[str], **extra):
    return {"interruptId": str(uuid.uuid4()), "kind": kind, "stage": stage,
            "message": {"prepare": "请检查模特、服装和背景，确认后配对。", "pairing": "请为模特选择服装。",
                        "tryon": "请检查试衣结果，可逐图修改。", "storyboard": "请检查走秀分镜，确认后生成视频。"}.get(stage, "请确认后继续。"),
            "mediaIds": media_ids, **extra}


def set_slot(items: list, index: int, value):
    """Selective historical forks retain order using explicit missing slots."""
    while len(items) <= index:
        items.append(None)
    items[index] = value


class Pipeline:
    def __init__(self, settings: Settings, repository, storage=None, providers=None):
        self.settings = settings
        self.repo = repository
        self.storage = storage or ObjectStorage(settings)
        self.providers = providers or Providers(settings)
        self.tools = MediaTools(settings)

    def current(self):
        run = self.repo.check()
        state = copy.deepcopy(run["state"])
        state.setdefault("mediaByStage", {})
        for kind in MEDIA_STAGES:
            state["mediaByStage"].setdefault(kind, [])
        state.setdefault("approvedStages", [])
        state.setdefault("appliedCommands", [])
        return run, state

    def persist(self, run, state, status="RUNNING", stage=None, pending=None):
        self.repo.check()
        self.repo.update_run(run["id"], status=status, stage=stage or run["stage"], state=state, pending=pending)

    def materialize(self, ids: list[str], directory: Path) -> list[Path]:
        paths = []
        for media_id in ids:
            self.repo.check()
            media = self.repo.media(media_id)
            extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "audio/mpeg": ".mp3"}.get(media["mime_type"], ".bin")
            path = directory / f"{uuid.uuid4().hex}{extension}"
            self.storage.download(media["object_key"], path)
            if media["mime_type"].startswith("image/"):
                normalized = directory / f"{uuid.uuid4().hex}.png"
                try:
                    with Image.open(path) as image:
                        image.convert("RGB").save(normalized, "PNG")
                except (OSError, ValueError) as error:
                    raise ValueError("UNSUPPORTED_INPUT_IMAGE") from error
                path = normalized
            paths.append(path)
        return paths

    def attempt(self, run, state, key: str, stage: str, provider: str, inputs: dict):
        self.repo.check()
        existing = self.repo.attempt(run["id"], key)
        if existing and existing["status"] == "SUCCEEDED":
            return existing, True
        if existing and self.recover_media(run, existing):
            return self.repo.attempt(run["id"], key), True
        terminal_video = existing and existing.get("error_code") in {"VIDEO_FAILED", "VIDEO_ERROR", "VIDEO_EXPIRED", "VIDEO_NOT_FOUND"}
        if existing and state.get("retryNonce") and existing["status"] in {"FAILED", "RUNNING", "NEEDS_ATTENTION"} and (not existing.get("provider_job_id") or terminal_video):
            key = f"{key}:retry:{state['retryNonce']}"
            existing = self.repo.attempt(run["id"], key)
        if existing:
            if existing["status"] == "SUCCEEDED":
                return existing, True
            if self.recover_media(run, existing):
                return self.repo.attempt(run["id"], key), True
            if existing.get("provider_job_id"):
                return existing, False
            if provider not in {"mock", "local"}:
                # A call may have reached the provider before the former process died.
                raise ProviderError("PREVIOUS_SUBMISSION_UNCERTAIN", uncertain=True)
            return existing, False
        return self.repo.begin_attempt(run["id"], key, stage, provider, inputs), False

    @staticmethod
    def media_identity(run, attempt, kind):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fashion-runway:{run['id']}:{attempt['id']}:{kind}"))

    def recover_media(self, run, attempt):
        kind = attempt["stage"]
        key = attempt["operation_key"]
        if key.startswith("prepare:prompt") or key.startswith("storyboard:vision:"):
            return False
        if kind == "compose":
            kind = "silent_video"
        elif kind == "music":
            kind = "poster" if key.startswith("poster") else "final_video" if key.startswith("music:mix") else "music"
        if kind not in MEDIA_STAGES:
            return False
        media_id = self.media_identity(run, attempt, kind)
        try:
            record = self.repo.media(media_id)
        except (ValueError, KeyError):
            record = None
        if record:
            self.repo.update_attempt(attempt["id"], status="SUCCEEDED", output_media_ids=[media_id])
            return True
        extension = ".mp4" if kind in {"video", "silent_video", "final_video"} else ".mp3" if kind == "music" else ".png"
        object_key = f"runway/{run['project_id']}/{run['id']}/{media_id}{extension}"
        if not self.storage.exists(object_key):
            return False
        with self.storage.workspace() as folder:
            path = folder / f"recovered{extension}"
            self.storage.download(object_key, path)
            self.register(run, attempt, path, kind, source={"recovered": True})
        return True

    def register(self, run, attempt, path: Path, kind: str, *, source=None):
        self.repo.check()
        media_id = self.media_identity(run, attempt, kind)
        mime_type = "video/mp4" if path.suffix == ".mp4" else "audio/mpeg" if path.suffix == ".mp3" else "image/png"
        metadata = {}
        if mime_type.startswith("image/"):
            with Image.open(path) as image:
                metadata = {"width": image.width, "height": image.height}
        else:
            metadata = self.tools.probe(path)
        key, digest, size = self.storage.upload(path, run["project_id"], run["id"], media_id, mime_type)
        self.repo.check()
        record = {"id": media_id, "run_id": run["id"], "project_id": run["project_id"], "kind": kind,
                  "object_key": key, "mime_type": mime_type, "original_name": f"{kind}-{media_id[:8]}{path.suffix}",
                  "size_bytes": size, "sha256": digest,
                  "source": {"mode": self.settings.mode, "operationKey": attempt["operation_key"], **(source or {})}, **metadata}
        self.repo.save_media_and_complete(record, attempt["id"])
        return media_id

    def image(self, run, state, key: str, kind: str, prompt: str, refs: list[str], index=0):
        provider = "mock" if self.settings.mode == "mock" else "legacy_google_gateway"
        attempt, done = self.attempt(run, state, key, kind, provider, {"prompt": prompt, "mediaIds": refs})
        if done:
            return attempt["output_media_ids"][0]
        try:
            with self.storage.workspace() as folder:
                inputs = self.materialize(refs, folder)
                output = folder / "result.png"
                self.providers.image(prompt, inputs, output, kind, index)
                return self.register(run, attempt, output, kind)
        except ProviderError as error:
            self.repo.update_attempt(attempt["id"], status="NEEDS_ATTENTION" if error.uncertain else "FAILED", error_code=error.code)
            raise

    def improve(self, run, state):
        attempt, done = self.attempt(run, state, "prepare:prompt", "prepare", "mock" if self.settings.mode == "mock" else "openrouter", {"prompt": run["input_snapshot"]["prompt"]})
        if done:
            return attempt["provider_data"]["improvedPrompt"]
        result = self.providers.improve(run["input_snapshot"]["prompt"])
        self.repo.update_attempt(attempt["id"], status="SUCCEEDED", provider_data={"improvedPrompt": result})
        return result

    def wait(self, run, state, stage: str, kind="confirm", ids=None, **extra):
        pending = pending_input(kind, stage, ids or [], **extra)
        self.persist(run, state, "WAITING_INPUT", stage, pending)
        return pending

    def inspect_storyboard(self, run, state, media_id, index):
        checks = state.setdefault("visionChecks", {})
        if self.settings.mode == "mock" or not self.settings.vision_key:
            checks[str(index)] = {"status": "skipped", "reason": "MOCK_MODE" if self.settings.mode == "mock" else "VISION_NOT_CONFIGURED", "mediaId": media_id}
            return media_id
        key = f"storyboard:vision:{index}:{media_id}"
        attempt = self.repo.attempt(run["id"], key)
        if attempt and attempt.get("provider_data", {}).get("result"):
            result = attempt["provider_data"]["result"]
            reason = attempt["provider_data"].get("reason")
        elif attempt:
            # The inspection may have reached the service before a former process died.
            result, reason = "UNAVAILABLE", "VISION_PREVIOUS_RESULT_UNCERTAIN"
            self.repo.update_attempt(attempt["id"], status="FAILED", provider_data={"result": result, "reason": reason}, error_code=reason)
        else:
            attempt = self.repo.begin_attempt(run["id"], key, "storyboard", "legacy_vision", {"mediaId": media_id})
            try:
                with self.storage.workspace() as folder:
                    result = self.providers.inspect_scale(self.materialize([media_id], folder)[0])
                if result not in {"PASS", "TOO_BIG"}:
                    raise ProviderError("VISION_EMPTY_OR_INVALID_FEEDBACK")
                reason = None
                self.repo.update_attempt(attempt["id"], status="SUCCEEDED", provider_data={"result": result})
            except ProviderError as error:
                result, reason = "UNAVAILABLE", error.code
                self.repo.update_attempt(attempt["id"], status="FAILED", provider_data={"result": result, "reason": reason}, error_code=reason)
        checks[str(index)] = {"status": "checked" if result != "UNAVAILABLE" else "unavailable", "result": result, "mediaId": media_id}
        if reason:
            checks[str(index)]["reason"] = reason
        if result == "TOO_BIG":
            try:
                replacement = self.image(run, state, f"storyboard:shrink:{index}:{media_id}", "storyboard",
                    "Edit this photo: keep background, outfit, lighting consistent. Reduce the model size so it matches the scale of the audience. Do not add or show any boxes or marks.", [media_id], index)
                checks[str(index)]["adjustedMediaId"] = replacement
                return replacement
            except ProviderError as error:
                # The original remains available for mandatory manual review, as in the legacy flow.
                checks[str(index)].update(status="adjustment_failed", reason=error.code)
        return media_id

    def apply_action(self, payload: dict):
        run, state = self.current()
        command_id = self.repo.command["id"]
        if command_id in state["appliedCommands"]:
            return
        action = payload.get("kind", self.repo.command["kind"])
        pending = run["pending_input"]
        if action == "start":
            return
        if action == "retry":
            state["retryNonce"] = command_id
            # If a requested image edit failed, retry that exact edit, not the whole review.
            previous = self.repo.one("SELECT payload FROM runway_commands WHERE run_id=%s AND kind='edit' AND status='FAILED' ORDER BY created_at DESC LIMIT 1", (run["id"],))
            if pending and previous:
                edit = previous["payload"]
                if edit.get("interruptId") == pending.get("interruptId"):
                    state = self.edit(run, state, edit)
        elif action == "keep_silent":
            if not state["mediaByStage"]["silent_video"]:
                raise ValueError("NO_SILENT_VIDEO")
            state["keepSilent"] = True
            run["stage"] = "finished"
        else:
            if not pending or payload.get("interruptId") != pending.get("interruptId"):
                raise ValueError("INTERRUPT_CONFLICT")
            if action == "edit":
                state = self.edit(run, state, payload)
            elif action == "pair":
                if pending["kind"] != "pair":
                    raise ValueError("NOT_PAIRING_STAGE")
                pairings = payload.get("pairings") or []
                models, clothes = state["mediaByStage"]["model"], state["mediaByStage"]["cloth"]
                if not pairings or any(p["modelMediaId"] not in models or p["clothMediaId"] not in clothes for p in pairings):
                    raise ValueError("PAIRING_MEDIA_INVALID")
                state["pairings"] = pairings
                run["stage"] = "tryon"
            elif action in {"confirm", "continue"}:
                if pending["kind"] != "confirm":
                    raise ValueError("PAIRING_REQUIRED")
                stage = pending["stage"]
                if stage not in state["approvedStages"]:
                    state["approvedStages"].append(stage)
                run["stage"] = {"prepare": "pairing", "tryon": "storyboard", "storyboard": "video"}[stage]
            else:
                raise ValueError("UNKNOWN_ACTION")
        state["appliedCommands"].append(command_id)
        state.pop("errorCode", None)
        self.persist(run, state, stage=run["stage"])

    def edit(self, run, state, payload):
        target = payload.get("mediaId")
        if not run["pending_input"] or target not in run["pending_input"].get("mediaIds", []):
            raise ValueError("EDIT_MEDIA_INVALID")
        kind = self.repo.media(target)["kind"]
        if kind not in {"model", "cloth", "background", "tryon", "storyboard"}:
            raise ValueError("EDIT_REQUIRES_IMAGE")
        replacement = self.image(run, state, f"edit:{self.repo.command['id']}", kind, payload["instruction"], [target])
        state["mediaByStage"][kind] = [replacement if value == target else value for value in state["mediaByStage"][kind]]
        return state

    def advance(self):
        while True:
            run, state = self.current()
            stage = run["stage"]
            media = state["mediaByStage"]
            self.persist(run, state, stage=stage)
            if stage == "prepare":
                if not state.get("improvedPrompt"):
                    state["improvedPrompt"] = self.improve(run, state)
                    self.persist(run, state)
                for kind in ("model", "cloth", "background"):
                    # User-supplied references are already approved input snapshots; generate only missing categories.
                    target = 1 if kind == "background" else run["input_snapshot"]["modelCount"]
                    if any(item.get("kind") == kind for item in run["input_snapshot"].get("inputs", [])) and media[kind]:
                        continue
                    for index in range(len(media[kind]), target):
                        value = self.image(run, state, f"prepare:{kind}:{index}", kind, image_prompt(kind, state["improvedPrompt"], index), [], index)
                        media[kind].append(value)
                        self.persist(run, state)
                return self.wait(run, state, "prepare", ids=media["model"] + media["cloth"] + media["background"])
            if stage == "pairing":
                if not media["model"] or not media["cloth"] or not media["background"]:
                    raise ValueError("MISSING_PREPARED_IMAGES")
                return self.wait(run, state, "pairing", "pair", media["model"] + media["cloth"], models=media["model"], clothes=media["cloth"])
            if stage == "tryon":
                pairs = state.get("pairings", [])
                if not pairs:
                    raise ValueError("PAIRING_REQUIRED")
                for index, pair in enumerate(pairs):
                    if index < len(media["tryon"]) and media["tryon"][index]:
                        continue
                    set_slot(media["tryon"], index, self.image(run, state, f"tryon:{index}", "tryon", TRYON, [pair["modelMediaId"], pair["clothMediaId"]], index))
                    self.persist(run, state)
                return self.wait(run, state, "tryon", ids=media["tryon"])
            if stage == "storyboard":
                if not media["tryon"] or not media["background"]:
                    raise ValueError("MISSING_TRYON_OR_BACKGROUND")
                for index, model in enumerate(media["tryon"]):
                    if index < len(media["storyboard"]) and media["storyboard"][index]:
                        continue
                    generated = self.image(run, state, f"storyboard:{index}", "storyboard", f"{state['improvedPrompt']}\n{STORYBOARD}", [model, media["background"][0]], index)
                    set_slot(media["storyboard"], index, self.inspect_storyboard(run, state, generated, index))
                    self.persist(run, state)
                return self.wait(run, state, "storyboard", ids=media["storyboard"])
            if stage == "video":
                if not media["storyboard"]:
                    raise ValueError("MISSING_STORYBOARDS")
                for index, image_id in enumerate(media["storyboard"]):
                    if index < len(media["video"]) and media["video"][index]:
                        continue
                    set_slot(media["video"], index, self.video(run, state, index, image_id))
                    self.persist(run, state)
                self.persist(run, state, stage="compose")
                continue
            if stage == "compose":
                if not media["video"]:
                    raise ValueError("MISSING_VIDEOS")
                if not media["silent_video"]:
                    attempt, done = self.attempt(run, state, "compose", "compose", "local", {"mediaIds": media["video"]})
                    if done:
                        media["silent_video"] = attempt["output_media_ids"]
                    else:
                        with self.storage.workspace() as folder:
                            paths = self.materialize(media["video"], folder)
                            output = folder / "composed.mp4"
                            self.tools.compose(paths, output, self.repo.check)
                            media["silent_video"] = [self.register(run, attempt, output, "silent_video")]
                    self.persist(run, state)
                self.poster(run, state)
                self.persist(run, state, stage="music" if run["input_snapshot"]["withMusic"] else "finished")
                continue
            if stage == "music":
                if not media["silent_video"]:
                    raise ValueError("MISSING_SILENT_VIDEO")
                self.music(run, state)
                self.persist(run, state, stage="finished")
                continue
            if stage == "finished":
                if not media["final_video"] and not media["silent_video"]:
                    raise ValueError("MISSING_FINAL_VIDEO")
                self.persist(run, state, "SUCCEEDED", "finished")
                return None
            raise ValueError("INVALID_PIPELINE_STAGE")

    def video(self, run, state, index, image_id):
        attempt, done = self.attempt(run, state, f"video:{index}", "video", "mock" if self.settings.mode == "mock" else "jimeng", {"imageId": image_id})
        if done:
            return attempt["output_media_ids"][0]
        try:
            with self.storage.workspace() as folder:
                image = self.materialize([image_id], folder)[0]
                output = folder / "video.mp4"
                if self.settings.mode == "mock":
                    self.tools.mock_video(image, output)
                else:
                    task_id = attempt.get("provider_job_id")
                    if not task_id:
                        task_id = self.providers.submit_video(image)
                        self.repo.update_attempt(attempt["id"], provider_job_id=task_id)
                    self.providers.wait_video(task_id, output, self.repo.check)
                return self.register(run, attempt, output, "video")
        except ProviderError as error:
            self.repo.update_attempt(attempt["id"], status="NEEDS_ATTENTION" if error.uncertain else "FAILED", error_code=error.code)
            raise

    def music(self, run, state):
        media = state["mediaByStage"]
        with self.storage.workspace() as folder:
            video = self.materialize(media["silent_video"], folder)[0]
            if not media["music"]:
                attempt, done = self.attempt(run, state, "music:generate", "music", "mock" if self.settings.mode == "mock" else "minimax", {"prompt": state["improvedPrompt"]})
                if done:
                    media["music"] = attempt["output_media_ids"]
                else:
                    output = folder / "music.mp3"
                    self.providers.music(state["improvedPrompt"], output, self.tools.probe(video)["duration_ms"] / 1000)
                    media["music"] = [self.register(run, attempt, output, "music")]
                self.persist(run, state)
            if not media["final_video"]:
                attempt, done = self.attempt(run, state, "music:mix", "music", "local", {"video": media["silent_video"], "audio": media["music"]})
                if done:
                    media["final_video"] = attempt["output_media_ids"]
                else:
                    audio = self.materialize(media["music"], folder)[0]
                    output = folder / "final.mp4"
                    self.tools.mix(video, audio, output)
                    media["final_video"] = [self.register(run, attempt, output, "final_video")]
                self.persist(run, state)
            self.poster(run, state)

    def poster(self, run, state):
        media = state["mediaByStage"]
        if not media["poster"]:
            attempt, done = self.attempt(run, state, "poster", "music", "local", {})
            if done:
                media["poster"] = attempt["output_media_ids"]
            else:
                with self.storage.workspace() as folder:
                    video = self.materialize(media["silent_video"], folder)[0]
                    output = folder / "poster.png"
                    self.tools.poster(video, output)
                    media["poster"] = [self.register(run, attempt, output, "poster")]


def build_graph(pipeline: Pipeline, checkpointer):
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import interrupt

    def work(state: GraphState):
        pipeline.advance()
        return state

    def wait(state: GraphState):
        # Human mutations are committed once by the command handler before resuming this node.
        interrupt(pipeline.repo.run(state["runId"])["pending_input"])
        return state

    def route(state: GraphState):
        return "wait" if pipeline.repo.run(state["runId"])["status"] == "WAITING_INPUT" else END

    graph = StateGraph(GraphState)
    graph.add_node("work", work)
    graph.add_node("wait", wait)
    graph.add_edge(START, "work")
    graph.add_conditional_edges("work", route)
    graph.add_edge("wait", "work")
    return graph.compile(checkpointer=checkpointer)
