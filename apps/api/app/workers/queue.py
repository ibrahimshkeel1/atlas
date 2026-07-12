from __future__ import annotations

from redis import Redis
from rq import Queue

from app.core.config import get_settings


def get_queue() -> Queue:
    settings = get_settings()
    conn = Redis.from_url(settings.redis_url)
    return Queue("atlas", connection=conn)


def enqueue_document_processing(document_id: str, job_id: str) -> str:
    queue = get_queue()
    job = queue.enqueue(
        "app.workers.tasks.process_document_task",
        document_id,
        job_id,
        job_timeout=600,
        result_ttl=3600,
        failure_ttl=86400,
    )
    return job.id
