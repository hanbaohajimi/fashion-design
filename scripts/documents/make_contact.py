from PIL import Image, ImageDraw
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
d = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'output/documents/workflow-report/pages'
files = sorted(d.glob('page-*.png'))
if not files:
    raise SystemExit(f'No page-*.png files found in {d}; render the document first or pass the page directory')
thumbs = []
for f in files:
    im = Image.open(f).convert('RGB')
    im.thumbnail((330, 430))
    canvas = Image.new('RGB', (350, 465), '#dddddd')
    canvas.paste(im, ((350 - im.width)//2, 10))
    ImageDraw.Draw(canvas).text((12, 442), f.name, fill='#222222')
    thumbs.append(canvas)
out = Image.new('RGB', (350*3, 465*((len(thumbs)+2)//3)), 'white')
for i, im in enumerate(thumbs):
    out.paste(im, ((i % 3)*350, (i // 3)*465))
out.save(d/'contact.png')
