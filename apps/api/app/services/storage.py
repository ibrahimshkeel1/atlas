from __future__ import annotations

import io
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from app.core.config import get_settings


def _local_root() -> Path:
    root = get_settings().resolved_storage_path()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _use_local() -> bool:
    return get_settings().storage_backend == "local"


def get_s3_client():
    import boto3
    from botocore.client import Config

    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket() -> None:
    if _use_local():
        _local_root()
        return
    settings = get_settings()
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        client.create_bucket(Bucket=settings.s3_bucket)


def upload_file(fileobj: BinaryIO, org_id: str, filename: str, content_type: str) -> str:
    from app.core.security_hardening import sanitize_filename

    safe_name = sanitize_filename(filename)
    key = f"orgs/{org_id}/documents/{uuid4().hex}/{safe_name}"
    data = fileobj.read()
    return upload_bytes(data, key, content_type)


def download_bytes(key: str) -> bytes:
    if _use_local():
        path = (_local_root() / key).resolve()
        root = _local_root().resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid storage key") from exc
        return path.read_bytes()
    settings = get_settings()
    client = get_s3_client()
    buf = io.BytesIO()
    client.download_fileobj(settings.s3_bucket, key, buf)
    return buf.getvalue()


def upload_bytes(data: bytes, key: str, content_type: str) -> str:
    if _use_local():
        path = (_local_root() / key).resolve()
        root = _local_root().resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid storage key") from exc
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key
    settings = get_settings()
    ensure_bucket()
    client = get_s3_client()
    client.put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def delete_object(key: str) -> None:
    if _use_local():
        path = _local_root() / key
        if path.exists() and path.is_file():
            path.unlink()
            parent = path.parent
            root = _local_root()
            while parent != root and parent.exists():
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        return
    settings = get_settings()
    client = get_s3_client()
    client.delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_url(key: str, expires_in: int = 3600) -> str:
    settings = get_settings()
    if _use_local():
        import time
        from urllib.parse import quote

        from app.api.v1.files import sign_key

        expires = int(time.time()) + expires_in
        signature = sign_key(key, expires)
        encoded = quote(key, safe="")
        return (
            f"{settings.api_public_url}/api/v1/files/{encoded}"
            f"?expires={expires}&signature={signature}"
        )
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires_in,
    )
