import pytest

ROUTER = "https://aistupidlevel.info/v1"

# A /v1/models answer in the router's own order: modes first ("auto" leads), then pinnable models.
MODELS_PAYLOAD = {
    "object": "list",
    "data": [
        {"id": "auto", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-coding", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-reasoning", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-tooling", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-best", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-value", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "auto-split", "object": "model", "owned_by": "aistupidlevel"},
        {"id": "claude-opus-5-5", "object": "model", "owned_by": "anthropic"},
        {"id": "gpt-6.1-sol", "object": "model", "owned_by": "openai"},
        {"id": "glm-5.3", "object": "model", "owned_by": "glm"},
    ],
}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Keep keys and endpoint overrides from the developer's shell out of the tests."""
    for name in ("AISTUPIDLEVEL_API_KEY", "ASL_ROUTER_KEY", "ASL_BASE_URL", "LANGFLOW_AISTUPIDLEVEL_API_KEY"):
        monkeypatch.delenv(name, raising=False)
