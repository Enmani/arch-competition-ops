from pathlib import Path

import pytest

from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.settings import DEFAULT_AI_SKILL, Settings


def test_repository_skill_overrides_bundled_instructions(tmp_path, monkeypatch):
    path = tmp_path / DEFAULT_AI_SKILL
    path.parent.mkdir(parents=True)
    path.write_text("Repository skill", encoding="utf-8")
    monkeypatch.setattr(
        "arch_competition_ops.screening.preferences.resources.files",
        lambda _package: pytest.fail("Bundled fallback must not override repository edits"),
    )
    assert (
        load_screening_instructions(Settings(root=tmp_path, _env_file=None)) == "Repository skill"
    )


def test_packaged_skill_works_without_the_repository(tmp_path, monkeypatch):
    bundled_root = tmp_path / "package"
    skill = bundled_root / "_bundled/screen-architecture-opportunities/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("Packaged skill", encoding="utf-8")
    monkeypatch.setattr(
        "arch_competition_ops.screening.preferences.resources.files", lambda _package: bundled_root
    )
    settings = Settings(root=tmp_path / "deployment", _env_file=None)
    assert load_screening_instructions(settings) == "Packaged skill"


def test_missing_custom_skill_fails_instead_of_silently_using_other_preferences(tmp_path):
    settings = Settings(root=tmp_path, _env_file=None, ai_preferences=Path("missing.md"))
    with pytest.raises(FileNotFoundError, match="Configured screening instructions"):
        load_screening_instructions(settings)


def test_empty_skill_fails_visibly(tmp_path):
    path = tmp_path / "custom.md"
    path.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="must not be empty"):
        load_screening_instructions(Settings(root=tmp_path, _env_file=None, ai_preferences=path))
