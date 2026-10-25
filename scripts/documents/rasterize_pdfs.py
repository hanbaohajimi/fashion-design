from __future__ import annotations

from pathlib import Path
import os

import fitz


ROOT = Path(__file__).resolve().parents[2]
WORK = Path(os.environ.get("FLOWBOOK_RENDER_DIR", ROOT / "output" / "documents" / "flowbooks"))
folders = sorted(WORK.glob("render-0*"))
if not folders:
    raise SystemExit(f"No render folders found in {WORK}; place PDFs in render-01, render-02, render-03 first")
for folder in folders:
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
