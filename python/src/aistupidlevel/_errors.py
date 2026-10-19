"""Errors raised by the client.

Every error says whose problem it is (``party``), whether retrying can help (``retryable``), and
carries the router's error ``code`` and the ``request_id`` when there is one.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

__all__ = [
    "ASLError", "BadRequestError", "AuthenticationError", "PermissionDeniedError", "ConflictError",
    "RateLimitError", "AllowanceExhaustedError", "BudgetExceededError", "ProviderQuotaError",
    "ProviderKeyError", "NoRoutableModelError", "ProviderRejectedError", "ModelUnavailableError",
    "ToolChoiceNotHonouredError", "ServerError", "ConnectionError", "TimeoutError", "StreamInterruptedError",
    "error_for",
]


class ASLError(Exception):
    """Base class. ``party`` is one of: request, account, provider_key, provider, router, network."""

    party = "router"
    retryable = False

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        type: Optional[str] = None,
        param: Optional[str] = None,
        request_id: Optional[str] = None,
        retry_after: Optional[float] = None,
        body: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.type = type
        self.param = param
        self.request_id = request_id
        #: Server-suggested wait before retrying, in seconds, when it sent one.
        self.retry_after = retry_after
        self.body = body
        self.headers = headers or {}

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(status={self.status!r}, code={self.code!r}, message={self.message!r})"


class BadRequestError(ASLError):
    """The request itself is wrong (400/404/413/422)."""
    party = "request"


class AuthenticationError(ASLError):
    """Missing, invalid or expired router key (401)."""
    party = "request"


class PermissionDeniedError(ASLError):
    """The key may not do this (403)."""
    party = "account"


class ConflictError(ASLError):
    """A request with the same idempotency key is still running (409). Retried automatically."""
    party = "router"
    retryable = True


class RateLimitError(ASLError):
    """Too many requests right now (429). Retried automatically, honouring Retry-After."""
    party = "account"
    retryable = True


class AllowanceExhaustedError(ASLError):
    """The plan's monthly allowance is used up and there are no prepaid credits (429). Not retried."""
    party = "account"


class BudgetExceededError(ASLError):
    """The key's or project's hard budget is reached (429 insufficient_quota). Not retried."""
    party = "account"


class ProviderQuotaError(ASLError):
    """Your provider account refused for credit or quota (429 provider_quota_exceeded). Not retried."""
    party = "provider_key"


class ProviderKeyError(ASLError):
    """No working provider key: missing (no_provider_keys) or refused (provider_key_rejected)."""
    party = "provider_key"


class NoRoutableModelError(ASLError):
    """Your routing preferences exclude every model (no_routable_model)."""
    party = "request"


class ProviderRejectedError(ASLError):
    """The provider refused the request itself (provider_rejected_request)."""
    party = "request"


class ModelUnavailableError(ASLError):
    """Every model in the chain failed provider-side (502). Retried automatically."""
    party = "provider"
    retryable = True


class ToolChoiceNotHonouredError(ASLError):
    """A forced tool call was answered without one on every model tried (502)."""
    party = "provider"


class ServerError(ASLError):
    """A 5xx from the router. Retried automatically."""
    party = "router"
    retryable = True


class ConnectionError(ASLError):  # noqa: A001 - deliberate, namespaced in the package
    """The connection failed before a response arrived. Retried automatically."""
    party = "network"
    retryable = True


class TimeoutError(ASLError):  # noqa: A001
    """No response within the timeout. Retried automatically."""
    party = "network"
    retryable = True


class StreamInterruptedError(ASLError):
    """A stream stopped after the answer had started (fallback is only possible before the first byte)."""
    party = "provider"


_BY_CODE = {
    "allowance_exhausted": AllowanceExhaustedError,
    "insufficient_quota": BudgetExceededError,
    "provider_quota_exceeded": ProviderQuotaError,
    "provider_key_rejected": ProviderKeyError,
    "no_provider_keys": ProviderKeyError,
    "no_routable_model": NoRoutableModelError,
    "provider_rejected_request": ProviderRejectedError,
    "model_unavailable": ModelUnavailableError,
    "tool_choice_not_honoured": ToolChoiceNotHonouredError,
    "idempotency_in_progress": ConflictError,
    "rate_limited": RateLimitError,
}


def error_for(status: int, body: Any, headers: Dict[str, str], retry_after: Optional[float]) -> ASLError:
    """The error class for an HTTP error response, from its status and the router's error code."""
    err = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), dict) else {}
    code = err.get("code") if isinstance(err.get("code"), str) else None
    message = err.get("message") or f"HTTP {status}"
    kwargs = dict(status=status, code=code, type=err.get("type"), param=err.get("param"),
                  request_id=headers.get("x-aism-request-id"), retry_after=retry_after, body=body, headers=headers)
    if code in _BY_CODE:
        return _BY_CODE[code](message, **kwargs)
    if status == 401:
        return AuthenticationError(message, **kwargs)
    if status == 403:
        return PermissionDeniedError(message, **kwargs)
    if status == 409:
        return ConflictError(message, **kwargs)
    if status == 429:
        return RateLimitError(message, **kwargs)
    if status >= 500:
        return ServerError(message, **kwargs)
    return BadRequestError(message, **kwargs)
