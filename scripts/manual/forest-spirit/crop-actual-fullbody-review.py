"""Unresized actual Core crops and fixed-background contacts; never a pose renderer."""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--current',type=Path,required=True);ap.add_argument('--prior',type=Path);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();assert not a.out.exists();a.out.mkdir(parents=True)
    groups={
        'right-arm-context':([90,390,470,1095],['neutral','hat-8-head0-e1','hat-16-head0-e1']),
        'right-axilla-waist':([125,805,435,1105],['neutral','hat-8-head0-e1','hat-16-head0-e1','axis-ParamFSPickup-maximum']),
        'neck-scarf':([300,550,790,800],['neutral','head-y-1-z-1-s-1-e1','head-y1-z1-s1-e1']),
        'right-shoulder':([260,650,450,820],['neutral','hat-8-head0-e1','head-y-1-z-1-s-1-e1','head-y1-z1-s1-e1']),
        'elbow-contact':([210,805,340,930],['neutral','hat-8-head0-e1','axis-ParamFSPickup-maximum']),
        'hat-contact':([90,350,350,730],['hat-16-head-1-e1','hat-16-head0-e1','hat-16-head1-e1'])}
    backgrounds={'white':(255,255,255),'pale-green':(224,234,216),'deep-green':(26,53,37)}
    evidence=[];input_hashes={}
    for label,(roi,states) in groups.items():
        w,h=roi[2]-roi[0],roi[3]-roi[1]
        for bg_name,rgb in backgrounds.items():
            sheet=Image.new('RGB',(w*len(states),h+28),'white');draw=ImageDraw.Draw(sheet)
            for i,state in enumerate(states):
                source=a.current/(state+'.png');digest=sha(source);input_hashes[str(source.resolve())]=digest
                image=Image.open(source).convert('RGBA');assert image.size==(971,1620)
                crop=Image.alpha_composite(Image.new('RGBA',(w,h),rgb+(255,)),image.crop(roi)).convert('RGB')
                crop.save(a.out/f'{label}--{state}--{bg_name}.png');sheet.paste(crop,(i*w,28));draw.text((i*w+3,8),state,fill='black')
                if bg_name=='white':evidence.append({'source':str(source.resolve()),'sha256':digest,'roi':roi,'resize':False,'retouch':False})
                if a.prior is not None and bg_name=='pale-green':
                    prior=a.prior/(state+'.png');input_hashes[str(prior.resolve())]=sha(prior);prior_image=Image.open(prior).convert('RGBA');assert prior_image.size==(971,1620)
                    prior_crop=Image.alpha_composite(Image.new('RGBA',(w,h),rgb+(255,)),prior_image.crop(roi)).convert('RGB')
                    pair=Image.new('RGB',(w*2,h+28),'white');pd=ImageDraw.Draw(pair);pair.paste(prior_crop,(0,28));pair.paste(crop,(w,28));pd.text((3,8),'PRIOR actual Core',fill='black');pd.text((w+3,8),'CURRENT actual Core',fill='black');pair.save(a.out/f'prior-current--{label}--{state}.png')
            sheet.save(a.out/f'{label}--contact--{bg_name}.png')
    assert all(sha(Path(p))==s for p,s in input_hashes.items())
    (a.out/'crop-provenance.json').write_text(json.dumps({'scope':'Unresized actual Core PNG crops; fixed backgrounds, no image correction or generated content','crops':evidence,'backgroundsRgb8':backgrounds,'inputsUnchanged':True,'inputHashes':input_hashes,'visualAcceptance':'manual_pending'},indent=2)+'\n',encoding='utf-8');print(a.out)

if __name__=='__main__':main()
