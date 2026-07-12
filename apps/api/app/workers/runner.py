from rq import Worker

from app.core.config import get_settings
from app.workers.queue import get_queue


def main() -> None:
    get_settings().assert_secure_enough()
    queue = get_queue()
    worker = Worker([queue], connection=queue.connection)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
