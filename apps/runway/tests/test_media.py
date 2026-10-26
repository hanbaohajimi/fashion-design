import shutil

import pytest
from PIL import Image

from fashion_runway.config import Settings
from fashion_runway.media import MediaTools


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="FFmpeg required")
def test_valid_mock_media_compose_and_audio_match(tmp_path):
    tools = MediaTools(Settings.from_env())
    image = tmp_path / "model.png"
    tools.mock_image(image, "model")
    with Image.open(image) as result:
        assert result.size == (512, 768)
    clip = tmp_path / "clip.mp4"
    tools.mock_video(image, clip)
    assert 900 <= tools.probe(clip)["duration_ms"] <= 1100
    combined = tmp_path / "combined.mp4"
    tools.compose([clip, clip], combined)
    music = tmp_path / "music.mp3"
    tools.mock_music(music, 1)
    final = tmp_path / "final.mp4"
    tools.mix(combined, music, final)
    metadata = tools.probe(final)
    assert metadata["width"] == 720
    assert metadata["height"] == 1080
    assert 1900 <= metadata["duration_ms"] <= 2150
    poster = tmp_path / "poster.png"
    tools.poster(final, poster)
    assert poster.stat().st_size > 0
