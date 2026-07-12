from __future__ import annotations

import re
import time
from collections import defaultdict
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for pilot hardening (single-process)."""

    def __init__(self, app, *, window_seconds: int = 60):
        super().__init__(app)
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        # path prefix -> max requests per window
        self.limits = {
            "/api/v1/auth/login": 20,
            "/api/v1/auth/signup": 10,
            "/api/v1/documents/upload": 30,
            "/api/v1/reports/export": 30,
        }

    def _client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    def _allow(self, key: str, limit: int) -> bool:
        now = time.time()
        with self._lock:
            bucket = self._hits[key]
            cutoff = now - self.window
            self._hits[key] = [t for t in bucket if t >= cutoff]
            if len(self._hits[key]) >= limit:
                return False
            self._hits[key].append(now)
            return True

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        limit = None
        for prefix, max_hits in self.limits.items():
            if path == prefix or path.startswith(prefix + "?"):
                limit = max_hits
                break
            if path.rstrip("/") == prefix.rstrip("/"):
                limit = max_hits
                break
        if limit is None:
            return await call_next(request)

        ip = self._client_ip(request)
        key = f"{ip}:{path}"
        if not self._allow(key, limit):
            return JSONResponse(
                {"detail": "Too many requests. Please wait and try again."},
                status_code=429,
            )
        return await call_next(request)


def sanitize_filename(filename: str) -> str:
    """Strip path components and unsafe characters for storage keys / display."""
    name = filename.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^\w.\- ()\[\]]+", "_", name).strip(" ._")
    if not name.lower().endswith(".pdf"):
        name = f"{name or 'statement'}.pdf"
    return name[:200] or "statement.pdf"
