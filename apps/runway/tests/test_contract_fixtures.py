import json
from pathlib import Path

import pytest

from fashion_runway.contracts import Action, Draft

fixtures = json.loads((Path(__file__).parent / "fixtures" / "contracts.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", fixtures, ids=[case["name"] for case in fixtures])
def test_platform_contract_fixture(case):
    schema = Draft if case["schema"] == "draft" else Action
    if not case["valid"]:
        with pytest.raises(ValueError):
            schema.model_validate(case["input"])
    else:
        result = schema.model_validate(case["input"])
        if "expected" in case:
            assert result.model_dump(exclude_none=True) == case["expected"]
