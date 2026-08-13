from __future__ import annotations

from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
for folder in sorted((ROOT / ".codex-work").glob("render-0*")):
    pdfs = list(folder.glob("*.pdf"))
    if len(pdfs) != 1:
        raise SystemExit(f"expected one PDF in {folder}, found {len(pdfs)}")
    pdf = fitz.open(pdfs[0])
    for old in folder.glob("page-*.png"):
        old.unlink()
    matrix = fitz.Matrix(160 / 72, 160 / 72)
    for index, page in enumerate(pdf, 1):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pix.save(folder / f"page-{index:02d}.png")
    print(f"{folder.name}: {pdf.page_count} pages")
