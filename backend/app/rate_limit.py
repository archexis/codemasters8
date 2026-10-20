"""In-memory sliding-window rate limiter for heavy projections.

WIRING (intentionally NOT enabled in main.py — see why below)::

    from backend.app.rate_limit import RateLimitMiddleware
    app.add_middleware(RateLimitMiddleware)  # defaults: see below

Why left disabled:
  * In-memory counters are per-process. Under multiple workers / serverless
    instances each keeps its own window, so limits are neither exact nor
    shared — production needs a shared store (Redis) before enforcing 429s.
  * An aggressive default could 429 legitimate polling (dossier/timeline
    pagination) and break TestClient suites that reuse one client IP.
  * Enable only after: shared counter backend + per-route budgets tuned from
    access logs + Retry-After handling on the frontend.

Design (no new dependencies):
  * Sliding window with per-key deque of hit timestamps; O(k) trim per hit.
  * Key = client IP + sha256(Bearer token or x-test-owner)[:16]. The raw
    token is never stored or logged.
  * Bounded memory: at most MAX_KEYS tracked keys, each at most limit+1
    timestamps; oldest-idle keys evicted first.
  * Over-limit responses are 429 JSON with a Retry-After header.
"""

import hashlib
import time
from collections import deque
from typing import Deque, Dict, Tuple

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Heavy projections worth throttling once a shared store exists.
DEFAULT_LIMITED_PREFIXES: Tuple[str, ...] = (
    "/api/summary",
    "/api/registry",
    "/api/export",
    "/api/complexes",  # covers dossier/verification/timeline/relations/preview
)

MAX_KEYS = 4096


class SlidingWindowLimiter:
    def __init__(self, limit: int = 60, window_s: float = 60.0) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: Dict[str, Deque[float]] = {}

    def _evict_idle(self, now: float) -> None:
        if len(self._hits) <= MAX_KEYS:
            return
        # Drop keys whose window is fully stale, oldest first.
        for key in sorted(self._hits, key=lambda k: self._hits[k][-1] if self._hits[k] else 0.0):
            last = self._hits[key][-1] if self._hits[key] else 0.0
            if len(self._hits) <= MAX_KEYS:
                break
            if now - last >= self.window_s:
                del self._hits[key]
        # Hard cap fallback: drop oldest regardless of staleness.
        while len(self._hits) > MAX_KEYS:
            oldest = min(self._hits, key=lambda k: self._hits[k][-1] if self._hits[k] else 0.0)
            del self._hits[oldest]

    def check(self, key: str, now: float | None = None) -> tuple[bool, float]:
        """Return (allowed, retry_after_s). Records the hit when allowed."""
        now = time.monotonic() if now is None else now
        bucket = self._hits.get(key)
        if bucket is None:
            bucket = self._hits[key] = deque()
        cutoff = now - self.window_s
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self.limit:
            return False, max(0.0, bucket[0] + self.window_s - now)
        bucket.append(now)
        self._evict_idle(now)
        return True, 0.0


def _request_key(scope: Scope) -> str:
    headers = dict((k.lower(), v) for k, v in scope.get("headers", []))
    client = scope.get("client")
    ip = client[0] if client else "unknown"
    auth = headers.get(b"authorization", b"").decode("latin1")
    if not auth:
        auth = headers.get(b"x-test-owner", b"").decode("latin1")
    digest = hashlib.sha256(auth.encode()).hexdigest()[:16] if auth else "anon"
    return f"{ip}|{digest}"


class RateLimitMiddleware:
    """429-guard for heavy GET projections. See module docstring: NOT wired."""

    def __init__(
        self,
        app: ASGIApp,
        limit: int = 60,
        window_s: float = 60.0,
        prefixes: Tuple[str, ...] = DEFAULT_LIMITED_PREFIXES,
    ) -> None:
        self.app = app
        self.prefixes = prefixes
        self.limiter = SlidingWindowLimiter(limit, window_s)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope.get("type") != "http"
            or scope.get("method") != "GET"
            or not scope.get("path", "").startswith(self.prefixes)
        ):
            await self.app(scope, receive, send)
            return
        allowed, retry_after = self.limiter.check(_request_key(scope))
        if allowed:
            await self.app(scope, receive, send)
            return
        response = JSONResponse({"detail": "Rate limit exceeded; retry later"}, status_code=429)
        response.headers["Retry-After"] = str(int(retry_after) + 1)
        await response(scope, receive, send)
