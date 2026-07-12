"""Regenerate sample statement PDFs for HBL / Meezan / UBL fixtures."""

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[3] / "sample-data"


def write_pdf(title: str, lines: list[str], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out), pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 750, title)
    c.setFont("Helvetica", 9)
    y = 720
    for line in lines:
        if y < 50:
            c.showPage()
            c.setFont("Helvetica", 9)
            y = 750
        c.drawString(40, y, line[:110])
        y -= 14
    c.save()
    print(f"Wrote {out}")


def main() -> None:
    fixtures = ROOT / "fixtures"
    for bank in ("hbl", "meezan", "ubl"):
        txt = fixtures / bank / "statement.txt"
        if not txt.exists():
            continue
        lines = [ln.rstrip() for ln in txt.read_text().splitlines() if ln.strip()]
        title = lines[0]
        write_pdf(title, lines, fixtures / bank / "statement.pdf")
        if bank == "hbl":
            write_pdf(title, lines, ROOT / "sample-bank-statement.pdf")


if __name__ == "__main__":
    main()
