from collections.abc import Mapping

from dify_plugin import ModelProvider

from models.llm.llm import check_router_key


class AIStupidLevelProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: Mapping) -> None:
        """Checks the router key with GET /v1/usage, which is free and not counted, so saving
        the key never spends a request or provider tokens."""
        check_router_key(credentials)
