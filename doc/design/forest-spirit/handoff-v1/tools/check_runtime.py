#!/usr/bin/env python3
"""Check local Cubism resource references; does not parse or certify MOC3 binaries.

Default mode checks this handoff's four P0 motion group names. Use --generic
for basic reference checks of a differently named model.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import sys


class ValidationError(ValueError):
    pass


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as exc:
        raise ValidationError(f'Cannot read JSON {path.name}: {exc}') from exc
    if not isinstance(data, dict):
        raise ValidationError(f'Expected JSON object: {path.name}')
    return data


def safe_local_reference(root: Path, raw: object) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValidationError('Empty or non-string resource reference')
    # Self-contained release bundles only. URLs, drives and traversal are rejected.
    normalized = raw.replace('\\', '/')
    posix = PurePosixPath(normalized)
    if ':' in normalized or posix.is_absolute() or '..' in posix.parts:
        raise ValidationError(f'Unsafe or external reference: {raw}')
    path = (root / Path(*posix.parts)).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValidationError(f'Reference leaves the model directory: {raw}')
    if not path.is_file() or path.stat().st_size == 0:
        raise ValidationError(f'Missing or empty resource: {raw}')
    return path


def check(entry: Path, project_checks: bool = True) -> dict:
    if not entry.is_file():
        return {'result': 'FAIL', 'errors': [f'Model entry not found: {entry}'],
                'note': 'The handoff intentionally contains no completed Live2D model.'}
    try:
        data = load_json(entry)
        if data.get('Version') != 3:
            raise ValidationError('Expected model3.json Version == 3')
        refs = data.get('FileReferences')
        if not isinstance(refs, dict):
            raise ValidationError('Missing FileReferences object')
        root = entry.resolve().parent
        moc = safe_local_reference(root, refs.get('Moc'))
        if moc.suffix.lower() != '.moc3':
            raise ValidationError('Moc reference must point to a .moc3 file')
        paths = [moc]
        textures = refs.get('Textures')
        if not isinstance(textures, list) or not textures:
            raise ValidationError('Textures must be a non-empty list')
        for raw in textures:
            p = safe_local_reference(root, raw)
            with p.open('rb') as handle:
                if handle.read(8) != b'\x89PNG\r\n\x1a\n':
                    raise ValidationError(f'Texture is not PNG: {raw}')
            paths.append(p)
        for key in ['Physics', 'Pose', 'DisplayInfo', 'UserData']:
            if key in refs:
                p = safe_local_reference(root, refs[key])
                load_json(p)
                paths.append(p)
        groups = refs.get('Motions', {})
        if not isinstance(groups, dict):
            raise ValidationError('Motions must be an object')
        if project_checks:
            missing = sorted({'Idle', 'Hover', 'DragHold', 'PutDown'} - set(groups))
            if missing:
                raise ValidationError(f'Missing project P0 motion groups: {missing}')
            if 'Physics' not in refs:
                raise ValidationError('Project expects exported Physics settings')
        motions_count = 0
        for group, motions in groups.items():
            if not isinstance(motions, list) or not motions:
                raise ValidationError(f'Empty or invalid motion group: {group}')
            for motion in motions:
                if not isinstance(motion, dict):
                    raise ValidationError(f'Invalid motion entry in {group}')
                p = safe_local_reference(root, motion.get('File'))
                obj = load_json(p)
                if obj.get('Version') != 3 or not isinstance(obj.get('Curves'), list) or not obj['Curves']:
                    raise ValidationError(f'Motion lacks Version 3 / non-empty Curves: {p.name}')
                paths.append(p)
                motions_count += 1
                if 'Sound' in motion:
                    paths.append(safe_local_reference(root, motion['Sound']))
        expressions = refs.get('Expressions', [])
        if not isinstance(expressions, list):
            raise ValidationError('Expressions must be an array')
        for expression in expressions:
            if not isinstance(expression, dict):
                raise ValidationError('Invalid expression entry')
            p = safe_local_reference(root, expression.get('File'))
            load_json(p)
            paths.append(p)
        return {'result': 'REFERENCES_OK_NOT_CORE_VALIDATED',
                'model': entry.name, 'unique_resources': len(set(paths)),
                'motion_files': motions_count,
                'warnings': ['MOC3 content is NOT parsed or validated here.',
                             'A real Core consistency check and browser render test are still required.',
                             'This does not prove texture quality, model compatibility or animation quality.']}
    except (ValidationError, OSError, TypeError) as exc:
        return {'result': 'FAIL', 'errors': [str(exc)]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('entry', type=Path)
    parser.add_argument('--generic', action='store_true', help='Skip project-specific groups/physics requirements')
    args = parser.parse_args()
    result = check(args.entry.resolve(), project_checks=not args.generic)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['result'] == 'REFERENCES_OK_NOT_CORE_VALIDATED' else 1


if __name__ == '__main__':
    sys.exit(main())
