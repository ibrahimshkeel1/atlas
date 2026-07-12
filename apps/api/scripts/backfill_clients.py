#!/usr/bin/env python3
"""Backfill default clients for every organization (idempotent).

  cd apps/api && python -m scripts.backfill_clients
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal  # noqa: E402
from app.services.clients import backfill_organization_clients  # noqa: E402


def main() -> int:
    db = SessionLocal()
    try:
        stats = backfill_organization_clients(db)
        db.commit()
        print("Client backfill complete:")
        for k, v in stats.items():
            print(f"  {k}: {v}")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"Backfill failed: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
