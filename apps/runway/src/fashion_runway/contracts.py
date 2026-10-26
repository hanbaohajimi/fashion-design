from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class InputReference(StrictModel):
    kind: Literal["model", "cloth", "background"]
    sourceType: Literal["file", "asset", "style_revision"]
    sourceId: str = Field(min_length=1, max_length=100)


class Draft(StrictModel):
    prompt: str = Field(min_length=1, max_length=8000)
    modelCount: int = Field(default=6, ge=1)
    withMusic: bool = True
    inputs: list[InputReference] = Field(default_factory=list, max_length=100)

    @field_validator("prompt", mode="before")
    @classmethod
    def trim_prompt(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def one_shared_background(self):
        if sum(item.kind == "background" for item in self.inputs) > 1:
            raise ValueError("one shared runway background is supported")
        return self


class Pairing(StrictModel):
    modelMediaId: str = Field(min_length=1)
    clothMediaId: str = Field(min_length=1)


class Action(StrictModel):
    kind: Literal["confirm", "pair", "edit", "retry", "continue", "keep_silent"]
    requestKey: str = Field(min_length=1, max_length=120)
    expectedVersion: int = Field(ge=1)
    interruptId: str | None = Field(default=None, min_length=1, max_length=120)
    pairings: list[Pairing] | None = Field(default=None, min_length=1)
    mediaId: str | None = Field(default=None, min_length=1)
    instruction: str | None = Field(default=None, min_length=1, max_length=4000)
    stage: Literal["prepare", "pairing", "tryon", "storyboard", "video", "compose", "music", "finished"] | None = None

    @field_validator("interruptId", "pairings", "mediaId", "instruction", "stage", mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("optional fields must be omitted, not null")
        return value

    @field_validator("instruction", mode="before")
    @classmethod
    def trim_instruction(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def fields_for_action(self):
        if self.kind == "pair" and not self.pairings:
            raise ValueError("pair requires pairings")
        if self.kind == "edit" and (not self.mediaId or not self.instruction or not self.instruction.strip()):
            raise ValueError("edit requires mediaId and instruction")
        return self


MEDIA_STAGES = ["model", "cloth", "background", "tryon", "storyboard", "video", "silent_video", "music", "final_video", "poster"]
PIPELINE_STAGES = ["prepare", "model", "cloth", "background", "pairing", "tryon", "storyboard", "video", "compose", "music", "finished"]
