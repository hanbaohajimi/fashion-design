"""Legacy-compatible adapters. No provider clients are constructed at import time."""

import base64
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
from PIL import Image

from .config import Settings
from .media import MediaTools
from .prompts import IMPROVE, VIDEO


class ProviderError(RuntimeError):
    def __init__(self, code: str, uncertain: bool = False, *, details=None):
        self.code = code
        self.uncertain = uncertain
        self.details = details or {}
        super().__init__(code)


def safe_provider_error(prefix: str, error: Exception) -> ProviderError:
    """Keep diagnostic status and classes, never SDK messages, URLs or response bodies."""
    response = getattr(error, "response", None)
    status = getattr(error, "status_code", None)
    if not isinstance(status, int):
        status = getattr(error, "code", None)
    if not isinstance(status, int) and response is not None:
        status = getattr(response, "status_code", None)
    details = {"causeClass": type(error).__name__}
    if error.__cause__:
        details["underlyingCauseClass"] = type(error.__cause__).__name__
    request_id = getattr(error, "request_id", None)
    if request_id is None and response is not None:
        headers = getattr(response, "headers", {})
        request_id = headers.get("x-request-id") or headers.get("request-id")
    if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", request_id):
        details["requestId"] = request_id
    if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599:
        details["httpStatus"] = status
        return ProviderError(f"{prefix}_HTTP_{status}", uncertain=status >= 500 or status == 408, details=details)
    if isinstance(error, (TypeError, ValueError)):
        return ProviderError(f"{prefix}_CONFIG_OR_RESPONSE_INVALID", details=details)
    return ProviderError(f"{prefix}_TRANSPORT_{type(error).__name__.upper()}", uncertain=True, details=details)


def require(value, name: str):
    if not value:
        raise ProviderError(f"PROVIDER_NOT_CONFIGURED:{name}")
    return value


def download(url: str, destination: Path, timeout: float) -> None:
    if urlsplit(url).scheme != "https":
        raise ProviderError("PROVIDER_DOWNLOAD_REQUIRES_HTTPS")
    try:
        with requests.get(url, timeout=timeout, stream=True) as response:
            response.raise_for_status()
            with destination.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
    except requests.RequestException as error:
        raise ProviderError("PROVIDER_DOWNLOAD_FAILED") from error


class Providers:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.tools = MediaTools(settings)

    def improve(self, prompt: str) -> str:
        if self.settings.mode == "mock":
            return f"MOCK / TEST ONLY. Fashion runway concept: {prompt}"
        require(self.settings.llm_key, "llm")
        from openai import OpenAI
        try:
            client = OpenAI(api_key=self.settings.llm_key, base_url=self.settings.llm_base_url, timeout=self.settings.request_timeout, max_retries=0)
            response = client.chat.completions.create(model=self.settings.llm_model, messages=[{"role": "system", "content": IMPROVE}, {"role": "user", "content": prompt}], response_format={"type": "json_object"})
            result = json.loads(response.choices[0].message.content or "{}").get("improved_input")
            if not isinstance(result, str) or not result.strip():
                raise ProviderError("LLM_EMPTY_RESULT")
            return result
        except ProviderError:
            raise
        except Exception as error:
            raise safe_provider_error("LLM", error) from error

    def image(self, prompt: str, references: list[Path], destination: Path, kind: str, index: int = 0) -> None:
        if self.settings.mode == "mock":
            self.tools.mock_image(destination, kind, index)
            return
        require(self.settings.image_key, "image")
        from google import genai
        from google.genai import types
        opened = []
        try:
            client = genai.Client(api_key=self.settings.image_key, vertexai=True,
                                  http_options=types.HttpOptions(base_url=self.settings.image_base_url, timeout=int(self.settings.request_timeout * 1000), retry_options=types.HttpRetryOptions(attempts=1)))
            opened = [Image.open(path) for path in references]
            result = client.models.generate_content(model=self.settings.image_model, contents=[*opened, prompt], config=types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K")))
            for candidate in result.candidates or []:
                for part in candidate.content.parts or []:
                    if part.inline_data and part.inline_data.data:
                        data = part.inline_data.data
                        destination.write_bytes(base64.b64decode(data) if isinstance(data, str) else data)
                        with Image.open(destination) as image:
                            image.convert("RGB").save(destination, "PNG")
                        return
            raise ProviderError("IMAGE_EMPTY_RESULT")
        except ProviderError:
            raise
        except Exception as error:
            raise safe_provider_error("IMAGE", error) from error
        finally:
            for image in opened:
                image.close()

    def inspect_scale(self, image: Path) -> str:
        require(self.settings.vision_key, "vision")
        from openai import OpenAI
        try:
            client = OpenAI(api_key=self.settings.vision_key, base_url=self.settings.vision_base_url,
                            timeout=self.settings.request_timeout, max_retries=0)
            response = client.chat.completions.create(model=self.settings.vision_model, temperature=0, max_tokens=30,
                messages=[{"role": "system", "content": "You check runway photos. Decide if the central model is proportional to the surrounding audience. Reply with a single token: PASS if the size looks consistent; TOO_BIG if the model is noticeably larger than the audience."},
                          {"role": "user", "content": [{"type": "text", "text": "Check size ratio of the model vs audience."},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode("ascii"), "detail": "low"}}]}])
            result = (response.choices[0].message.content or "").strip().upper()
            if result not in {"PASS", "TOO_BIG"}:
                raise ProviderError("VISION_EMPTY_OR_INVALID_FEEDBACK")
            return result
        except ProviderError:
            raise
        except Exception as error:
            raise safe_provider_error("VISION", error) from error

    def submit_video(self, image: Path) -> str:
        require(self.settings.volc_ak and self.settings.volc_sk, "video")
        from volcengine.visual.VisualService import VisualService
        try:
            service = VisualService()
            service.set_ak(self.settings.volc_ak)
            service.set_sk(self.settings.volc_sk)
            response = service.cv_sync2async_submit_task({"req_key": self.settings.video_req_key, "prompt": VIDEO, "seed": -1,
                                                         "frames": self.settings.video_frames, "binary_data_base64": [base64.b64encode(image.read_bytes()).decode("ascii")]})
            task_id = (response.get("data") or {}).get("task_id")
            if not task_id:
                code = response.get("code")
                suffix = f"_{code}" if isinstance(code, int) or isinstance(code, str) and code.isdigit() else ""
                raise ProviderError("VIDEO_SUBMIT_REJECTED" + suffix)
            return str(task_id)
        except ProviderError:
            raise
        except Exception as error:
            raise safe_provider_error("VIDEO_SUBMIT", error) from error

    def wait_video(self, task_id: str, destination: Path, check=lambda: None) -> None:
        from volcengine.visual.VisualService import VisualService
        service = VisualService()
        service.set_ak(self.settings.volc_ak)
        service.set_sk(self.settings.volc_sk)
        started = time.monotonic()
        while time.monotonic() - started < self.settings.video_timeout:
            check()
            try:
                response = service.cv_sync2async_get_result({"req_key": self.settings.video_req_key, "task_id": task_id})
                data = response.get("data") or {}
                status = str(data.get("status", "")).lower()
                if status == "done" and data.get("video_url"):
                    download(data["video_url"], destination, self.settings.request_timeout)
                    self.tools.probe(destination)
                    return
                if status in {"failed", "error", "not_found", "expired"}:
                    raise ProviderError(f"VIDEO_{status.upper()}")
            except ProviderError:
                raise
            except Exception as error:
                raise safe_provider_error("VIDEO_POLL", error) from error
            time.sleep(self.settings.poll_interval)
        raise ProviderError("VIDEO_POLL_TIMEOUT")

    def music(self, prompt: str, destination: Path, seconds: float) -> None:
        if self.settings.mode == "mock":
            self.tools.mock_music(destination, seconds)
            return
        require(self.settings.music_key, "music")
        try:
            response = requests.post(self.settings.music_base_url.rstrip("/") + "/v1/music_generation",
                                     headers={"Authorization": f"Bearer {self.settings.music_key}"},
                                     json={"model": self.settings.music_model, "prompt": f"Instrumental fashion runway background music. {prompt}"[:2000], "is_instrumental": True,
                                           "output_format": "hex", "audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"}}, timeout=self.settings.request_timeout)
            if response.status_code != 200:
                raise ProviderError(f"MUSIC_HTTP_{response.status_code}", uncertain=response.status_code >= 500 or response.status_code == 408, details={"httpStatus": response.status_code})
            result = response.json()
            if result.get("base_resp", {}).get("status_code", -1) != 0:
                code = result.get("base_resp", {}).get("status_code")
                suffix = f"_{code}" if isinstance(code, int) else ""
                raise ProviderError("MUSIC_REQUEST_REJECTED" + suffix)
            data = result.get("data") or {}
            if data.get("audio"):
                destination.write_bytes(bytes.fromhex(data["audio"]))
            elif data.get("audio_url"):
                download(data["audio_url"], destination, self.settings.request_timeout)
            else:
                raise ProviderError("MUSIC_EMPTY_RESULT")
            if self.tools.probe(destination)["duration_ms"] <= 0:
                raise ProviderError("MUSIC_INVALID_RESULT")
        except ProviderError:
            raise
        except requests.RequestException as error:
            raise safe_provider_error("MUSIC", error) from error
        except Exception as error:
            raise ProviderError("MUSIC_RESPONSE_INVALID") from error
