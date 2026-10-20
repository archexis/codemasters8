"""Response security headers (additive, non-breaking).

Adds static hardening headers to every response and ``Cache-Control: no-store``
to authenticated GET projections. Existing explicit headers (e.g. /api/export,
signal PDF) are never overwritten.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    # Local http:// origins ignore HSTS per spec; https prod gets one year.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

# Authenticated GET projections whose responses must never be cached by
# browsers/CDN (per-client workspace data). Prefix match on request path.
NO_STORE_PREFIXES = (
    "/api/summary",
    "/api/export",
    "/api/map-summary",
    "/api/publications",
    "/api/registry",
    "/api/complexes",
    "/api/cases",
    "/api/imports",
    "/api/document-jobs",
)


class SecurityHeadersMiddleware:
    """Pure-ASGI middleware: only sets response headers, never blocks."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "")
        path = scope.get("path", "")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "response.start":
                headers = MutableHeaders(raw=message.setdefault("headers", []))
                for name, value in SECURITY_HEADERS.items():
                    if name.lower() not in headers:
                        headers.append(name, value)
                if (
                    method == "GET"
                    and path.startswith(NO_STORE_PREFIXES)
                    and "cache-control" not in headers
                ):
                    headers.append("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_with_headers)
