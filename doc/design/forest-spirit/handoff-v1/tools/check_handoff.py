#!/usr/bin/env python3
"""Check reference handoff integrity. Standard library only; not a Live2D validator."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    with path.open('rb') as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b'\x89PNG\r\n\x1a\n' or header[12:16] != b'IHDR':
        raise ValueError(f'Not a PNG with an IHDR header: {path}')
    return struct.unpack('>II', header[16:24])


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def check(root: Path) -> dict:
    errors: list[str] = []
    try:
        manifest = read_json(root / 'specs/reference_manifest.json')
        source = root / manifest['source_file']
        if digest(source) != manifest['source_sha256']:
            errors.append('Approved source SHA256 mismatch')
        if list(png_size(source)) != manifest['source_size']:
            errors.append('Approved source dimensions mismatch')
        for ref in manifest['references']:
            p = root / ref['file']
            if not p.is_file():
                errors.append(f'Missing reference: {ref["file"]}')
                continue
            if digest(p) != ref['sha256']:
                errors.append(f'Reference hash mismatch: {ref["file"]}')
            if list(png_size(p)) != ref['size']:
                errors.append(f'Reference dimensions mismatch: {ref["file"]}')
            if 'crop_xyxy' in ref:
                x0, y0, x1, y1 = ref['crop_xyxy']
                w, h = manifest['source_size']
                if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
                    errors.append(f'Invalid crop bounds: {ref["file"]}')
                if [x1-x0, y1-y0] != ref['size']:
                    errors.append(f'Crop-size mismatch: {ref["file"]}')
        for p in (root / 'specs').glob('*.json'):
            read_json(p)
        for file, key in [('layers.manifest.json', 'layers'),
                          ('parameters.spec.json', 'parameters'),
                          ('motions.spec.json', 'motions')]:
            items = read_json(root / 'specs' / file)[key]
            ids = [item['id'] for item in items]
            if len(ids) != len(set(ids)):
                errors.append(f'Duplicate IDs: {file}')
        for p in read_json(root / 'specs/parameters.spec.json')['parameters']:
            if not p['min'] <= p['default'] <= p['max']:
                errors.append(f'Invalid parameter range: {p["id"]}')
        lock = read_json(root / 'specs/character.lock.json')
        if lock['source_sha256'] != manifest['source_sha256']:
            errors.append('Visual lock does not refer to the approved source')
        config = read_json(root / 'specs/interaction.config.json')['user_confirmed']
        if config['eyelashes_allowed'] is not False or config['autonomous_roaming'] is not False:
            errors.append('Confirmed no-lashes/no-roaming constraints changed')
        for required in ['README.md', 'CODEX_START_HERE.md', 'reference_index.html',
                         'specs/runtime.contract.ts']:
            if not (root / required).is_file():
                errors.append(f'Missing document: {required}')
        status = read_json(root / 'specs/asset.status.json')
        missing = [asset['id'] for asset in status['assets'] if asset['status'] != 'complete']
        return {'result': 'PASS' if not errors else 'FAIL',
                'scope': 'REFERENCE PACK INTEGRITY ONLY; NOT PRODUCTION-MODEL READINESS',
                'source_dimensions': manifest['source_size'],
                'reference_images': len(manifest['references']) + 1,
                'pixel_exact_crops_declared': sum('crop_xyxy' in r for r in manifest['references']),
                'errors': errors,
                'production_model_status': status['live2d_model'],
                'outstanding_assets': missing}
    except (OSError, ValueError, KeyError, TypeError, struct.error) as exc:
        return {'result': 'FAIL', 'errors': [str(exc)]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = check(args.root.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
