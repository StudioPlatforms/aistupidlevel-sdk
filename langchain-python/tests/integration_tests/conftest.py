import os

import pytest

SANDBOX_ONLY_FAILS = ("test_tool_calling", "test_tool_calling_async", "test_unicode_tool_call_integration")


def pytest_collection_modifyitems(items):
    if os.environ.get("ASL_LIVE") == "1":
        return
    for item in items:
        if item.originalname in SANDBOX_ONLY_FAILS:
            item.add_marker(pytest.mark.xfail(reason="sandbox answers use placeholder tool arguments", strict=True))
