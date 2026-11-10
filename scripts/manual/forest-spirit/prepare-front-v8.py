"""Freeze the user-approved frontal v8 source and its real-artwork delivery plan."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png'
SHA = 'da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e'
SPEC_DIR = ROOT / 'doc/design/forest-spirit/production/front-v8'
OUT = ROOT / 'output/forest-spirit-production-v2/front-v8'

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SHA
    master = SPEC_DIR / 'master/forest-spirit-front-v8.png'
    master.parent.mkdir(parents=True, exist_ok=True)
    if master.exists():
        assert hashlib.sha256(master.read_bytes()).hexdigest() == SHA, 'Never replace a different master'
    else:
        shutil.copy2(SOURCE, master)
    write_json(SPEC_DIR / 'master/metadata.json', {
        'schemaVersion': 1, 'characterId': 'forest-spirit-front-v8',
        'status': 'user_approved_flat_master_production_art_not_yet_completed',
        'approved': True, 'approval': 'User explicitly locked v8 in planning and requested implementation of the complete v8 plan.',
        'source': str(SOURCE), 'sha256': SHA, 'canvas': {'width': 971, 'height': 1620},
        'format': 'RGBA PNG', 'immutableOriginal': True,
        'appearance': ['Fully frontal face/body/feet', 'Moss/sage green, flax/ivory, bark brown', 'Scarf hides neck', 'Brown checked underskirt and thin moss trim', 'Ivory plus crosses inside brown embroidered eyes', 'No eyelashes', 'Small curved smile, soft unstitched blush', 'Short brown boots and functional tool pouch'],
        'productionArtExists': False, 'realFrontalModelAccepted': False,
    })
    old = json.loads((SPEC_DIR.parent / 'layers-v2.json').read_text(encoding='utf-8-sig'))
    remove = {'Hat_Ribbon', 'Bell_Cord', 'Bell_Body'}
    rename = {'Hair_FlowerTie':'Hair_BraidTie', 'Hat_Flowers':'Hat_Acorns', 'Skirt_RedPanel':'Skirt_CheckPanel',
              'Scarf_Main':'Scarf_Back', 'Scarf_Knot':'Scarf_Upper', 'Scarf_Tail_A':'Scarf_Middle', 'Scarf_Tail_B':'Scarf_Lower'}
    petals = {'Skirt_Petal_L', 'Skirt_Petal_Center', 'Skirt_Petal_R'}
    rolls = {'Tool_PatternRoll', 'Tool_FabricRoll'}
    notes = {
        'Hair_Back':'Preserve v8 flax hair; reconstruct hidden roots and braid overlaps locally. Green braid tie only, no flowers or ribbons.',
        'Legs_Boots':'Preserve v8 oatmeal socks and brown boots. Fill hidden skirt/boot-cuff connections; wooden buttons stay rigid.',
        'Body_Garment':'Preserve v8 sage capelet, moss bodice, four ivory skirt petals and brown checked underskirt. Checks/trim stay attached to cloth. Fill sleeve, pouch and adjacent-panel occlusions.',
        'Arms_Hands':'Separate upper sleeve, lower sleeve and hand on each anatomical side. Fill actual shoulder/elbow connections for hat touch and pickup without redesigning visible shapes.',
        'Scarf':'Four real wrap layers: back, upper, middle and lower. Upper wrap covers neck in all planned poses without covering face. Only lower wrap is physics driven; no knot or tails.',
        'Face':'Original facial pixels; remove duplicated features from clean face base. Crosses are independent and clipped/deformed with brown eyes; closed eyes are clean arcs with no lashes. Neck/ear support is reconstructed only where hidden.',
        'Hair_Front':'Preserve pale flax bangs and side locks; reconstruct only hidden roots/overlaps with logged repair masks.',
        'Hat':'Deep moss rounded hat, oak leaves, acorns and tiny berries. No flower, bell or red cord. Ornament follows hat; fill inner brim and hair-root overlaps.',
        'Pouch':'Brown pouch/strap, gold rigid scissors and three separate ivory rolls. Back/front pouch correctly occlude tool ends; no emblem redesign.',
        'Optional_Props':'P2 not produced; no empty placeholder PNG or import layer.',
    }
    labels = {
        'Blush_L': '解剖左侧柔和非针缝腮红',
        'Blush_R': '解剖右侧柔和非针缝腮红',
        'Nose': '原图粉色圆润小鼻',
        'Peplum_L': '解剖左侧腰片：观者右侧两瓣',
        'Peplum_Center': '正中腰片：中央一瓣',
        'Peplum_R': '解剖右侧腰片：观者左侧两瓣',
        'Tool_Roll_A': '观者左侧后排高纸卷',
        'Tool_Roll_B': '观者右侧后排高纸卷',
        'Tool_Roll_C': '前排较短纸卷',
    }
    details = {
        'Blush_L': 'Anatomical left is viewer-right. Preserve the original soft diffuse pink blush; no stitch dots or new marks.',
        'Blush_R': 'Anatomical right is viewer-left. Preserve the original soft diffuse pink blush; no stitch dots or new marks.',
        'Nose': 'Preserve the original small rounded pink nose and its source texture/highlight; do not replace it with a stitch line.',
        'Peplum_L': 'Own both viewer-right olive lobes, including the outer lobe partly occluded by the pouch. Together the three Peplum layers must cover all five source lobes; record each ownership/repair mask and preserve each scallop.',
        'Peplum_Center': 'Own the single central olive lobe. Together the three Peplum layers must cover all five source lobes; record each ownership/repair mask and preserve each scallop.',
        'Peplum_R': 'Own both viewer-left olive lobes. Together the three Peplum layers must cover all five source lobes; record each ownership/repair mask and preserve each scallop.',
        'Tool_Roll_A': 'Own the viewer-left tall rear roll within the viewer-right pouch cluster, identifiable by its upper opening to the left of Roll_B. Keep it independent; reconstruct only its occluded lower portion.',
        'Tool_Roll_B': 'Own the viewer-right tall rear roll within the viewer-right pouch cluster, identifiable by its upper opening to the right of Roll_A. Keep it independent; reconstruct only its occluded lower portion.',
        'Tool_Roll_C': 'Own the shorter front roll with the lower visible opening, in front of the two tall rear rolls. Keep all three rolls independent; preserve their source overlap and pouch-front occlusion.',
    }
    layers = []
    for layer in old['layers']:
        key = layer['id']
        if key in remove: continue
        if key in petals and key != 'Skirt_Petal_L': continue
        if key in rolls and key != 'Tool_PatternRoll': continue
        ids = ['Skirt_Petal_Front_L', 'Skirt_Petal_Front_R', 'Skirt_Petal_Side_L', 'Skirt_Petal_Side_R'] if key == 'Skirt_Petal_L' else ['Tool_Roll_A','Tool_Roll_B','Tool_Roll_C'] if key == 'Tool_PatternRoll' else [rename.get(key,key)]
        for name in ids:
            note = notes[layer['group']] + (' ' + details[name] if name in details else '')
            layers.append({'id':name,'group':layer['group'],'group_label':layer.get('group_label',layer['group']),
                'label':labels.get(name, name if name != key else layer['label']), 'phase':layer['phase'],
                'status':'missing_production_art' if layer['phase']=='P0' else 'not_in_scope',
                'source':'user_approved_frontal_v8_original_pixels_and_logged_local_repairs',
                'delivery_file':f'layers/{name}.png','notes':note,'pixel_delivery':note})
    p0 = [x for x in layers if x['phase']=='P0']
    assert len(p0)==72 and len(layers)==75 and len({x['id'] for x in layers})==75
    write_json(SPEC_DIR / 'layers.json', {
        'schemaVersion':1,'characterId':'forest-spirit-front-v8','status':'approved_source_production_layers_pending',
        'source_master':'master/forest-spirit-front-v8.png','source_sha256':SHA,'working_canvas':[971,1620],
        'layer_count':75,'p0_count':72,'p2_count':3,'coordinate_convention':'Full native canvas; origin (0,0); L/R are anatomical, never mirror the source.',
        'draw_order':'Explicit numeric order in actual delivery metadata; lower is behind. Plan array order is NOT Cubism draw order.',
        'removed_layers':sorted(remove),'renamed_layers':rename,
        'replacement_layers':{'old_three_skirt_petals':['Skirt_Petal_Front_L','Skirt_Petal_Front_R','Skirt_Petal_Side_L','Skirt_Petal_Side_R'],'old_two_roll_layers':['Tool_Roll_A','Tool_Roll_B','Tool_Roll_C']},
        'parameter_count':17,'physics_output_count':6,
        'quality_spec':'quality-spec.json','layers':layers,
    })
    OUT.mkdir(parents=True, exist_ok=True)
    print(json.dumps({'master':str(master),'sha256':SHA,'spec':str(SPEC_DIR/'layers.json'),'p0':72,'p2':3,'output':str(OUT)},ensure_ascii=False))

if __name__ == '__main__':
    main()
