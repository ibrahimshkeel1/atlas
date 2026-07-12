from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.config import get_settings

router = APIRouter(prefix="/files", tags=["files"])


def sign_key(key: str, expires: int) -> str:
    settings = get_settings()
    msg = f"{key}:{expires}".encode()
    return hmac.new(settings.file_hmac_secret().encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(key: str, expires: int, signature: str) -> bool:
    if expires < int(time.time()):
        return False
    expected = sign_key(key, expires)
    return hmac.compare_digest(expected, signature)


@router.get("/{file_path:path}")
def download_file(
    file_path: str,
    expires: int = Query(...),
    signature: str = Query(...),
):
    settings = get_settings()
    if settings.storage_backend != "local":
        raise HTTPException(status_code=404, detail="Not found")

    key = unquote(file_path)
    if not verify_signature(key, expires, signature):
        raise HTTPException(status_code=403, detail="Invalid or expired link")

    storage_root = settings.resolved_storage_path()
    path = storage_root / key
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        path.resolve().relative_to(storage_root.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Invalid path") from exc

    return FileResponse(path)
