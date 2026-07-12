#!/usr/bin/env bash
# Save a GCP service account JSON locally (gitignored).
# Usage:
#   ./scripts/save-gcp-sa.sh /path/to/downloaded-key.json
# or pipe JSON:
#   pbpaste | ./scripts/save-gcp-sa.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/gcp-sa.json"
mkdir -p "$ROOT/data"

if [[ "${1:-}" != "" && -f "$1" ]]; then
  cp "$1" "$OUT"
else
  cat > "$OUT"
fi

chmod 600 "$OUT"
python3 - <<PY
import json
from pathlib import Path
p = Path("$OUT")
data = json.loads(p.read_text())
assert data.get("type") == "service_account"
print("Saved service account for project:", data.get("project_id"))
print("Client email:", data.get("client_email"))
print("Path:", p)
PY
