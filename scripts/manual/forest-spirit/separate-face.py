"""Separate approved v2 facial pixels with explicit masks and local cloth repair.

No whole-face generation. Original source is read-only. Closed-eye arcs and hidden
cloth/ear extensions are explicitly recorded reconstructed artwork, not extraction.
"""
from __future__ import annotations
import hashlib
import json
import argparse
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/forest-spirit-production-v2/face'
from PIL import Image, ImageDraw, ImageChops, ImageFilter, ImageStat
SOURCE = ROOT / 'doc/design/forest-spirit/production/master/forest-spirit-approved-v2.png'
W, H = (982, 1602)
FACE = [(637, 327), (652, 324), (670, 333), (681, 350), (700, 361), (722, 387), (739, 416), (749, 449), (760, 477), (763, 500), (754, 526), (737, 549), (709, 569), (671, 586), (627, 599), (579, 605), (544, 597), (523, 582), (507, 560), (499, 537), (491, 510), (491, 484), (503, 460), (522, 433), (540, 414), (563, 402), (584, 390), (604, 369), (619, 345)]
EAR_R = [(391, 512), (410, 519), (425, 530), (425, 578), (410, 579), (394, 574), (382, 563), (377, 549), (379, 533)]
NECK = [(583, 602), (607, 601), (633, 595), (637, 610), (645, 625), (622, 628), (599, 621), (590, 614)]
REFINE = False

def pillow_main():
    """Dependency-free first production pass, all changes confined to named masks."""
    from collections import deque
    for folder in (OUT, OUT / 'layers', OUT / 'masks', OUT / 'qa'):
        folder.mkdir(parents=True, exist_ok=True)
    src = Image.open(SOURCE).convert('RGBA')
    rgb = src.convert('RGB')
    zero = Image.new('L', (W, H))

    def poly(points):
        m = zero.copy()
        ImageDraw.Draw(m).polygon(points, fill=255)
        return m

    def mask_save(name, m):
        m.save(OUT / 'masks' / (name + '.png'))
    face, ear, neck = (poly(FACE), poly(EAR_R), poly(NECK))
    ownership = ImageChops.lighter(ImageChops.lighter(face, ear), neck)
    mask_save('face-ownership', ownership)
    mask_save('face-visible', face)

    def extract(box, kind):
        x0, y0, x1, y1 = box
        crop = rgb.crop(box)
        cw, ch = crop.size
        px = crop.load()
        pts = set()
        for y in range(ch):
            for x in range(cw):
                r, g, b = px[x, y]
                valid = r < 215 and g < 165 and (b < 115) and (r - g > 24) if kind == 'brown' else r > 205 and g > 175 and (b > 130) if kind == 'cross' else r - g > 58 and g - b > 20 and (g < 185)
                if valid:
                    pts.add((x, y))
        best = set()
        while pts:
            seed = pts.pop()
            component = {seed}
            q = deque([seed])
            while q:
                x, y = q.popleft()
                for n in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if n in pts:
                        pts.remove(n)
                        component.add(n)
                        q.append(n)
            if len(component) > len(best):
                best = component
        local = Image.new('L', (cw + 2, ch + 2))
        d = ImageDraw.Draw(local)
        for x, y in best:
            d.point((x + 1, y + 1), fill=255)
        if kind != 'cross':
            ImageDraw.floodfill(local, (0, 0), 128)
            local = local.point(lambda v: 0 if v == 128 else 255)
        m = zero.copy()
        m.paste(local.crop((1, 1, cw + 1, ch + 1)), (x0, y0))
        return m
    masks = {'Eye_R_Open': extract((549, 433, 606, 513), 'brown'), 'Eye_L_Open': extract((699, 405, 744, 478), 'brown'), 'Brow_R': extract((538, 395, 578, 418), 'brown'), 'Brow_L': extract((685, 360, 722, 381), 'brown'), 'Nose': extract((651, 471, 688, 498), 'red'), 'Mouth': extract((653, 500, 704, 530), 'red')}
    masks['Blush_R'] = poly([(536, 529), (552, 512), (573, 512), (591, 521), (599, 541), (585, 562), (561, 566), (541, 552)])
    masks['Blush_L'] = poly([(735, 477), (743, 467), (759, 464), (773, 480), (777, 498), (762, 511), (746, 505)])
    masks['Eye_R_Cross'] = extract((568, 456, 592, 490), 'cross')
    masks['Eye_L_Cross'] = extract((712, 421, 735, 452), 'cross')
    donors = {'Eye_R_Open': (65, -25), 'Eye_L_Open': (-65, 0), 'Brow_R': (75, 35), 'Brow_L': (-30, 20), 'Nose': (-25, -35), 'Mouth': (-15, 40), 'Blush_R': (50, -5), 'Blush_L': (-50, 50)}
    clean = rgb.copy()
    union = zero.copy()
    repairs = {}
    for name, (dx, dy) in donors.items():
        m = ImageChops.darker(masks[name].filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(1)), face)
        donor = ImageChops.offset(clean if REFINE else rgb, -dx, -dy)
        box = m.getbbox()
        expanded = (max(0, box[0] - 5), max(0, box[1] - 5), min(W, box[2] + 5), min(H, box[3] + 5))
        receiving = rgb.crop(expanded)
        patch = donor.crop(expanded)
        rim = ImageChops.subtract(m.filter(ImageFilter.MaxFilter(11)), m).crop(expanded)
        if rim.getbbox():
            target_mean = ImageStat.Stat(receiving, rim).mean
            donor_mean = ImageStat.Stat(patch, rim).mean
            bands = []
            for band, t, s in zip(donor.split(), target_mean, donor_mean):
                bands.append(band.point(lambda p, delta=t - s: max(0, min(255, round(p + delta)))))
            donor = Image.merge('RGB', bands)
        clean.paste(donor, (0, 0), m)
        union = ImageChops.lighter(union, m)
        repairs[name] = m
        masks[name] = m
        mask_save('repair-' + name, m)
    mask_save('face-local-feature-repair', union)
    expanded = face.filter(ImageFilter.MaxFilter(29))
    hidden = ImageChops.subtract(expanded, face)
    concealed = Image.new('L', (W, H))
    ImageDraw.Draw(concealed).rectangle((0, 0, W, 550), fill=255)
    hidden = ImageChops.darker(hidden, concealed)
    expanded = ImageChops.lighter(face, hidden)
    tile = clean.crop((605, 410, 652, 470))
    extended = clean.copy()
    cloth = Image.new('RGB', (W, H))
    for y in range(0, H, 60):
        for x in range(0, W, 47):
            cloth.paste(tile, (x, y))
    extended.paste(cloth, (0, 0), hidden)
    mask_save('face-hidden-extension-repair', hidden)

    def part(image, mask):
        result = image.convert('RGBA')
        result.putalpha(mask)
        return result
    layers = {'Face_Base': part(extended, expanded), 'Ear_R': part(rgb, ear), 'Neck': part(rgb, neck)}
    layers['Ear_L'] = ImageChops.offset(layers['Ear_R'], 358, -83)
    mask_save('repair-Ear_L-occluded-local-copy', layers['Ear_L'].getchannel('A'))
    if REFINE:
        # Prevent a cheek layer from retaining the bottom edge of an open eye.
        for side in ('L', 'R'):
            eye_exclusion = masks[f'Eye_{side}_Open'].filter(ImageFilter.MaxFilter(9)).point(lambda p: 255 if p > 0 else 0)
            masks[f'Blush_{side}'] = ImageChops.subtract(masks[f'Blush_{side}'], eye_exclusion)
            mask_save(f'Blush_{side}-eye-exclusion', eye_exclusion)
    for side in ('L', 'R'):
        cross = ImageChops.darker(masks[f'Eye_{side}_Cross'].filter(ImageFilter.MaxFilter(3)), masks[f'Eye_{side}_Open'])
        masks[f'Eye_{side}_Cross'] = cross
        eye = rgb.copy()
        center = (578, 475) if side == 'R' else (721, 440)
        donor = ImageChops.offset(rgb, 0, -15)
        eye.paste(donor, (0, 0), cross)
        layers[f'Eye_{side}_Open'] = part(eye, masks[f'Eye_{side}_Open'])
        layers[f'Eye_{side}_Cross'] = part(rgb, cross)
        mask_save(f'repair-Eye_{side}_Cross', cross)
        hi = Image.new('L', (W * 4, H * 4))
        d = ImageDraw.Draw(hi)
        width = 34 if side == 'R' else 25
        points = []
        for i in range(41):
            t = i / 40
            x = center[0] + (t - 0.5) * width
            y = center[1] + 7 * (1 - (2 * t - 1) ** 2) - 0.2 * (x - center[0])
            points.append((round(x * 4), round(y * 4)))
        d.line(points, fill=255, width=12)
        arc = hi.resize((W, H), Image.Resampling.LANCZOS)
        tex = rgb.crop((center[0] - 8, center[1] + 10, center[0] + 8, center[1] + 22)).resize((W, H), Image.Resampling.BILINEAR)
        layers[f'Eye_{side}_Closed'] = part(tex, arc)
    for name in ('Brow_L', 'Brow_R', 'Nose', 'Mouth', 'Blush_L', 'Blush_R'):
        layers[name] = part(rgb, masks[name])
    order = ['Neck', 'Ear_L', 'Ear_R', 'Face_Base', 'Blush_L', 'Blush_R', 'Eye_L_Open', 'Eye_R_Open', 'Eye_L_Closed', 'Eye_R_Closed', 'Brow_L', 'Brow_R', 'Nose', 'Mouth', 'Eye_L_Cross', 'Eye_R_Cross']
    entries = []
    for i, name in enumerate(order):
        layer = layers[name]
        alpha = layer.getchannel('A')
        assert alpha.getbbox(), name
        layer.save(OUT / 'layers' / (name + '.png'))
        mask_save(name, alpha)
        repaired = []
        kind = 'source_pixels_with_shape_following_cloth_edge'
        if name == 'Face_Base':
            kind = 'source_cloth_local_translated_patch_repair'
            repaired = ['masks/face-local-feature-repair.png', 'masks/face-hidden-extension-repair.png']
        elif name == 'Ear_L':
            kind = 'occluded_ear_local_copy_reconstruction'
            repaired = ['masks/repair-Ear_L-occluded-local-copy.png']
        elif name.endswith('_Closed'):
            kind = 'new_clean_arc_with_original_brown_stitch_texture'
        elif name.endswith('_Open'):
            kind = 'source_brown_eye_local_cross_removal'
            repaired = [f'masks/repair-Eye_{name[4]}_Cross.png']
        entries.append({'id': name, 'group': 'Face', 'path': f'layers/{name}.png', 'visible': not name.endswith('_Closed'), 'opacity': 1, 'order': 500 + i, 'source': kind, 'patchedMask': repaired, 'mask': f'masks/{name}.png', 'alphaPixels': sum(alpha.histogram()[1:]), 'sha256': hashlib.sha256((OUT / 'layers' / (name + '.png')).read_bytes()).hexdigest()})
    data = {'schemaVersion': 1, 'characterId': 'forest-spirit-approved-v2', 'stage': 'production-p0', 'status': 'first_local_separation_pass_neutral_checked_deformation_review_pending', 'canvas': {'width': W, 'height': H}, 'method': 'Pillow original-pixel masks and local translated texture patches', 'source': str(SOURCE), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'sourceUnmodified': True, 'ownershipMask': 'masks/face-ownership.png', 'anatomicalConvention': 'L/R anatomical; viewer-left eye=Eye_R', 'layers': entries, 'limitations': ['First local cloth repair pass requires visual refinement before final rigging.', 'Hidden Ear_L reconstructed from original Ear_R local pixels.', 'Temporary head composites are excluded from the 16 production layers.', 'Original partial interior alpha causes measured recomposition alpha differences; not claimed identical.']}
    if REFINE:
        data['status'] = 'refinement_v2_candidate_not_yet_reimported'
        data['changesFromImportV1'] = ['Remove open-eye pixels accidentally included in cheek layer masks.', 'Use already-clean cloth as texture donors to avoid transferring other facial features.']
    (OUT / 'metadata.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    outside = src.copy()
    outside.putalpha(ImageChops.subtract(src.getchannel('A'), ownership))
    behind = outside.copy()
    front = outside.copy()
    yb = Image.new('L', (W, H))
    ImageDraw.Draw(yb).rectangle((0, 645, W, H), fill=255)
    behind.putalpha(ImageChops.darker(outside.getchannel('A'), yb))
    front.putalpha(ImageChops.subtract(outside.getchannel('A'), yb))
    behind.save(OUT / 'layers/Temp_BodyComposite.png')
    front.save(OUT / 'layers/Temp_HeadHairHatComposite.png')
    head = dict(data)
    head['stage'] = 'head-stage'
    head['layers'] = [{'id': 'Temp_BodyComposite', 'group': 'Temp_Body', 'path': 'layers/Temp_BodyComposite.png', 'visible': True, 'order': 0, 'temporary': True}, *entries, {'id': 'Temp_HeadHairHatComposite', 'group': 'Temp_HeadFront', 'path': 'layers/Temp_HeadHairHatComposite.png', 'visible': True, 'order': 1000, 'temporary': True}]
    (OUT / 'head-stage.metadata.json').write_text(json.dumps(head, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def composite(closed):
        im = Image.new('RGBA', (W, H))
        for item in sorted(head['layers'], key=lambda x: x['order']):
            name = item['id']
            visible = item['visible']
            if name.startswith('Eye_'):
                visible = name.endswith('_Closed') if closed else not name.endswith('_Closed')
            if visible:
                im = Image.alpha_composite(im, Image.open(OUT / item['path']))
        return im
    neutral, closed = (composite(False), composite(True))
    neutral.save(OUT / 'qa/neutral-composite.png')
    closed.save(OUT / 'qa/closed-composite.png')
    layers['Face_Base'].crop((470, 315, 790, 635)).resize((640, 640)).save(OUT / 'qa/face-base-detail.png')
    contact = Image.new('RGB', (1200, 420), (245, 240, 231))
    draw = ImageDraw.Draw(contact)
    for i, (label, im) in enumerate((('SOURCE', src), ('NEUTRAL', neutral), ('CLOSED', closed))):
        thumb = im.crop((480, 330, 780, 630)).resize((400, 400))
        contact.paste(thumb, (i * 400, 20), thumb)
        draw.text((i * 400 + 8, 5), label, fill=(40, 50, 40))
    contact.save(OUT / 'qa/comparison-contact.png')
    difference = ImageChops.difference(src, neutral)
    stats = ImageStat.Stat(difference)
    metrics = {'neutralFullCanvasMeanChannelDifference': stats.mean, 'neutralFullCanvasMaxChannelDifference': [v[1] for v in difference.getextrema()], 'faceOwnershipPixels': sum(ownership.histogram()[1:]), 'nonEmptyProductionLayers': len(entries), 'note': 'Measured differences, not a quality pass. Original alpha is preserved in temporary composites; production overlays accumulate alpha.'}
    (OUT / 'qa/metrics.json').write_text(json.dumps(metrics, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metrics, indent=2))

def validate_delivery():
    """Read-only PNG dimensions, non-empty masks, stored hashes and ROI differences."""
    base = ROOT / 'output/forest-spirit-production-v2/face'
    source = Image.open(SOURCE).convert('RGBA')
    summary = {'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'versions': {}}
    for name, folder in (('import-v1', base), ('refinement-v2', base / 'refinement-v2')):
        data = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
        checks = []
        for layer in data['layers']:
            path = folder / layer['path']
            image = Image.open(path)
            checks.append({'id': layer['id'], 'size': list(image.size), 'mode': image.mode, 'non_empty': bool(image.getchannel('A').getbbox()), 'sha_matches_metadata': hashlib.sha256(path.read_bytes()).hexdigest() == layer['sha256'], 'visible': layer['visible']})
        difference = ImageChops.difference(source, Image.open(folder / 'qa/neutral-composite.png').convert('RGBA'))
        mask = Image.open(folder / 'masks/face-ownership.png')
        summary['versions'][name] = {'layers': checks, 'all_checks_pass': all(item['size'] == [W,H] and item['mode'] == 'RGBA' and item['non_empty'] and item['sha_matches_metadata'] for item in checks), 'ownership_roi_rgba_mean_difference': ImageStat.Stat(difference, mask).mean}
    (base / 'qa/pixel-delivery-validation.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'source_sha256': summary['source_sha256'], 'versions': {key: {'layers': len(value['layers']), 'all_checks_pass': value['all_checks_pass'], 'face_roi_rgba_mean': value['ownership_roi_rgba_mean_difference']} for key,value in summary['versions'].items()}}, indent=2))

def coverage_check():
    """Static raster precheck only; this never edits layers or a Cubism project."""
    data = json.loads((OUT / 'head-stage.metadata.json').read_text(encoding='utf-8'))
    qa = OUT / 'qa/coverage'
    qa.mkdir(parents=True, exist_ok=True)
    body = Image.new('RGBA', (W, H))
    head = Image.new('RGBA', (W, H))
    for item in sorted(data['layers'], key=lambda value: value['order']):
        if not item.get('visible', True):
            continue
        layer = Image.open(OUT / item['path']).convert('RGBA')
        if item['id'] == 'Temp_BodyComposite':
            body = Image.alpha_composite(body, layer)
        else:
            head = Image.alpha_composite(head, layer)
    neutral = Image.alpha_composite(body, head)
    src = Image.open(SOURCE).convert('RGBA')
    src_opaque = src.getchannel('A').point(lambda p: 255 if p >= 250 else 0)
    junction = Image.new('L', (W, H))
    ImageDraw.Draw(junction).rectangle((340, 610, 820, 675), fill=255)
    neck = Image.new('L', (W, H))
    ImageDraw.Draw(neck).rectangle((560, 595, 660, 655), fill=255)
    contact = Image.new('RGB', (1440, 440), (238, 233, 222))
    findings = []
    for index, angle in enumerate((-3, 0, 3)):
        rotated = head.rotate(angle, resample=Image.Resampling.BICUBIC, center=(612, 615))
        posed = Image.alpha_composite(body, rotated)
        posed.save(qa / f'head-tilt-{angle:+d}.png')
        low_alpha = posed.getchannel('A').point(lambda p: 255 if p < 220 else 0)
        vacated = ImageChops.darker(src_opaque, low_alpha)
        seam = ImageChops.darker(vacated, junction)
        neck_gap = ImageChops.darker(vacated, neck)
        seam.save(qa / f'junction-exposure-mask-{angle:+d}.png')
        overlay = posed.copy()
        red = Image.new('RGBA', (W, H), (235, 30, 45, 0))
        red.putalpha(seam.point(lambda p: 180 if p else 0))
        overlay = Image.alpha_composite(overlay, red)
        overlay.save(qa / f'junction-exposure-overlay-{angle:+d}.png')
        crop = overlay.crop((340, 560, 820, 700)).resize((480, 420))
        contact.paste(crop, (index * 480, 20), crop)
        ImageDraw.Draw(contact).text((index * 480 + 8, 5), f'Raster precheck {angle:+d} deg; red=alpha gap', fill=(30, 45, 30))
        findings.append({'angleDegrees': angle, 'pivot': [612,615], 'junctionExposurePixels': sum(seam.histogram()[1:]), 'junctionExposureBounds': seam.getbbox(), 'neckExposurePixels': sum(neck_gap.histogram()[1:]), 'neckExposureBounds': neck_gap.getbbox()})
    contact.save(qa / 'junction-contact.png')
    report = {'type': 'programmatic_raster_coverage_precheck_NOT_CUBISM', 'sourceLayersUnchanged': True, 'angles': findings, 'regions': {'junction': [340,610,820,675], 'neck': [560,595,660,655]}, 'limitations': ['Rotation moves the temporary head/hair/hat composite and all visible Face layers as one rigid raster head.', 'Temporary body is static, split at y=645; exposed scarf/hair edges at this temporary split are not proof that the final 73-layer rig has the same gap.', 'Alpha loss outside the source silhouette can be intended motion; only the marked junction ROI is counted here.', 'This is not a Cubism mesh, deformation or physical motion test.']}
    (qa / 'coverage-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refine', action='store_true', help='Write a separate refinement-v2 candidate without changing imported v1 pixels.')
    parser.add_argument('--rebuild-import-v1', action='store_true', help='Explicitly regenerate the frozen import v1; do not use while Cubism import is in progress.')
    parser.add_argument('--coverage-only', action='store_true', help='Read existing output and produce separate +/-3 degree raster coverage evidence without editing layers.')
    parser.add_argument('--validate-only', action='store_true', help='Read-only image dimensions, alpha and hash validation for both existing versions.')
    options = parser.parse_args()
    if options.refine:
        REFINE = True
        OUT = OUT / 'refinement-v2'
    elif (OUT / 'metadata.json').exists() and not options.rebuild_import_v1 and not options.coverage_only and not options.validate_only:
        raise SystemExit('Import v1 is frozen. Use --refine for a separate candidate, or explicitly --rebuild-import-v1 after coordinating reimport.')
    if options.validate_only:
        validate_delivery()
    elif options.coverage_only:
        coverage_check()
    else:
        pillow_main()
