"""Typed integration port for #94-#97; not a working repository implementation."""
from typing import Iterable, Protocol

from ..auth.session_service import SessionContext
from ..permissions.gateway import WriteConditions


class BusinessRepository(Protocol):
    def get(self, kind: str, key: str) -> dict | None:
        """Strong read of the requested entity type; absent -> None, outage -> raise."""
        ...

    def list(self, kind: str, context: SessionContext, parent: dict | None) -> Iterable[dict]:
        """All candidates within server grant scopes and parent, never global count."""
        ...

    def mutate(self, kind: str, action: str, payload: dict, record: dict | None,
               parent: dict | None, conditions: WriteConditions,
               idempotency_key: str | None, upload=None) -> dict:
        """Values + references + atomic checks/write + stamps; return saved record.

        Capture the trusted request context when constructing the adapter.
        WriteConditions is not enough to authorize referenced records/assignees.
        Must reject unsupported kinds/uploads; never return an unsaved payload.
        """
        ...
