"""The extension manifest and the provider it registers in Langflow's model system."""

import json
import sys
from pathlib import Path

import pytest
from langchain_aistupidlevel import ChatAISL
from lfx.base.models import provider_registry
from lfx.base.models.unified_models import get_llm, get_model_providers, get_unified_models_detailed
from lfx.extension import load_extension, validate_extension

import lfx_aistupidlevel
from lfx_aistupidlevel import discovery

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

PACKAGE_ROOT = Path(lfx_aistupidlevel.__file__).resolve().parent
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROVIDER = "AI Stupid Level"


@pytest.fixture
def loaded():
    """Load the extension the way Langflow does at startup, and undo the registration afterwards."""
    provider_registry.clear()
    result = load_extension(PACKAGE_ROOT)
    try:
        yield result
    finally:
        provider_registry.clear()


def test_versions_agree():
    pyproject = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text())
    manifest = json.loads((PACKAGE_ROOT / "extension.json").read_text())
    assert pyproject["project"]["version"] == manifest["version"] == lfx_aistupidlevel.__version__


def test_entry_point_points_at_the_package():
    pyproject = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text())
    assert pyproject["project"]["entry-points"]["langflow.extensions"] == {"lfx-aistupidlevel": "lfx_aistupidlevel"}


def test_manifest_passes_the_langflow_validator():
    report = validate_extension(PACKAGE_ROOT)
    assert report.ok, report.errors


def test_loading_registers_the_provider_and_the_component(loaded):
    assert loaded.ok, (loaded.errors, loaded.warnings)
    assert not loaded.warnings
    assert [c.namespaced_id for c in loaded.components] == ["ext:aistupidlevel:AIStupidLevelComponent@official"]

    assert provider_registry.is_registered(PROVIDER)
    assert PROVIDER in get_model_providers()
    assert provider_registry.provider_id_for(PROVIDER) == "aistupidlevel"
    assert provider_registry.resolve_provider_id("aistupidlevel") == "aistupidlevel"
    assert not provider_registry.is_api_key_optional(PROVIDER)
    assert provider_registry.live_discovery_for(PROVIDER) is discovery.fetch_live_models
    assert provider_registry.validator_for(PROVIDER) is discovery.validate_credentials


def test_static_catalog_lists_the_routing_modes(loaded):
    [entry] = get_unified_models_detailed(providers=[PROVIDER], model_type="llm")
    names = [m["model_name"] for m in entry["models"]]
    assert names == list(discovery.ROUTING_MODES)
    assert names[0] == "auto-coding"
    assert [n for n in names if next(m for m in entry["models"] if m["model_name"] == n)["metadata"]["default"]] == [
        "auto-coding",
        "auto-tooling",
        "auto-reasoning",
        "auto-best",
        "auto-value",
    ]
    assert all(m["metadata"]["tool_calling"] for m in entry["models"])
    assert entry["icon"] == "Gauge"
    assert entry["provider_id"] == "aistupidlevel"
    assert [v["variable_key"] for v in entry["variables"]] == ["AISTUPIDLEVEL_API_KEY"]


def test_no_embedding_models(loaded):
    assert get_unified_models_detailed(providers=[PROVIDER], model_type="embeddings") == []
    assert discovery.fetch_live_models(None, "embeddings") == []


def test_get_llm_builds_chataisl_from_the_provider_key(loaded, monkeypatch):
    """The Language Model and Agent components call get_llm with the picked model."""
    monkeypatch.setenv("AISTUPIDLEVEL_API_KEY", "aism_from_env")
    llm = get_llm(model=[{"name": "auto-coding", "provider": PROVIDER, "metadata": {}}], user_id=None, temperature=0.2)
    assert isinstance(llm, ChatAISL)
    assert llm.model_name == "auto-coding"
    assert llm.openai_api_key.get_secret_value() == "aism_from_env"
    assert llm.openai_api_base == "https://aistupidlevel.info/v1"
    assert llm.temperature == 0.2
    assert llm.include_response_headers is True


def test_get_llm_without_a_key_names_the_variable(loaded):
    with pytest.raises(ValueError, match="AISTUPIDLEVEL_API_KEY"):
        get_llm(model=[{"name": "auto-coding", "provider": PROVIDER, "metadata": {}}], user_id=None)


def test_default_base_url_matches_chataisl():
    from langchain_aistupidlevel.chat_models import DEFAULT_BASE_URL

    assert discovery.DEFAULT_BASE_URL == DEFAULT_BASE_URL
