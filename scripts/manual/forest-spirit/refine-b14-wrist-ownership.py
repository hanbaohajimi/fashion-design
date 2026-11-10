"""Transfer original braid-tip texels misassigned to the wrist, preserving neutral RGBA."""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    repo=Path(__file__).resolve().parents[3];root=repo/'output/forest-spirit-production-v2/front-v8';mp=root/'fullbody/revisions/b13-combined-source-r4/fullbody.metadata.json'
    assert sha(mp)=='2375cd52b9cff8e598eb81ced977aaa52802268cc7b09eb20a55143c85a0f440';meta=json.loads(mp.read_text(encoding='utf-8'));rows={r['id']:r for r in meta['layers']}
    images={id:np.array(Image.open(mp.parent/r['path']).convert('RGBA')) for id,r in rows.items()};before={id:x.copy() for id,x in images.items()}
    out=a.out.resolve();assert out.is_relative_to(repo/'output') and not out.exists()
    for folder in ['layers','masks','source-visible','qa']:(out/folder).mkdir(parents=True,exist_ok=True)
    sv={id:np.array(Image.open(mp.parent/rows[id]['sourceVisible']).convert('RGBA')) for id in ['Hand_R','Braid_Tip']}
    yy,xx=np.mgrid[:1620,:971];h=images['Hand_R'];rgb=h[:,:,:3].astype(int)
    region=(xx>=145)&(xx<173)&(yy>=976)&(yy<992)&(xx<171-.82*(yy-979))
    mask=region&(sv['Hand_R'][:,:,3]>0)&(h[:,:,3]>0)&(images['Braid_Tip'][:,:,3]==0)&(rgb[:,:,0]-rgb[:,:,1]>14)&(rgb[:,:,1]-rgb[:,:,2]>17)
    assert mask.any();images['Braid_Tip'][mask]=h[mask];images['Hand_R'][mask]=0;sv['Braid_Tip'][mask]=sv['Hand_R'][mask];sv['Hand_R'][mask]=0
    master_path=repo/'output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png';master=np.array(Image.open(master_path).convert('RGBA'))
    assert np.array_equal(before['Hand_R'][:,:,:3][mask],master[:,:,:3][mask])
    Image.fromarray(mask.astype(np.uint8)*255).save(out/'masks/original-braid-fringe-Hand-to-BraidTip.png')
    def composite(items):
        result=Image.new('RGBA',(971,1620))
        for r in sorted(meta['layers'],key=lambda r:r['order']):
            if r.get('visible',True):result.alpha_composite(Image.fromarray(items[r['id']]))
        return result
    old,new=composite(before),composite(images);diff=np.abs(np.array(old).astype(int)-np.array(new).astype(int));assert not diff.any(),'Neutral must remain unchanged'
    old.save(out/'qa/b13-neutral.png');new.save(out/'qa/b14-wrist-neutral.png')
    for id in ['Hand_R','Braid_Tip']:
        Image.fromarray(images[id]).save(out/f'layers/{id}.png');Image.fromarray(sv[id]).save(out/f'source-visible/{id}.png')
        roi=(140,965,195,1005);w,h=roi[2]-roi[0],roi[3]-roi[1];sheet=Image.new('RGB',(w*4*3,h*4+24),'white');d=ImageDraw.Draw(sheet)
        for i,(im,label) in enumerate([(master,'MASTER'),(before[id],'b13 source'),(images[id],'b14 candidate')]):
            rgba=Image.fromarray(im);bg=Image.alpha_composite(Image.new('RGBA',rgba.size,(224,234,216,255)),rgba).crop(roi).resize((w*4,h*4),Image.Resampling.NEAREST);sheet.paste(bg,(i*w*4,24));d.text((i*w*4,5),label,fill='black')
        sheet.save(out/f'qa/{id}-ownership-context-4x.png')
    subset={'schemaVersion':1,'characterId':'forest-spirit-front-v8','canvas':{'width':971,'height':1620},'stage':'source-candidate-subset','layers':[{'id':id,'path':f'layers/{id}.png','sha256':sha(out/f'layers/{id}.png'),'sourceVisible':f'source-visible/{id}.png'} for id in ['Hand_R','Braid_Tip']]}
    (out/'subset.metadata.json').write_text(json.dumps(subset,indent=2)+'\n',encoding='utf-8');ys,xs=np.where(mask)
    report={'scope':'Original-pixel ownership correction candidate; no model/rig written','sourceMetadataSha256':sha(mp),'sourceMasterSha256':sha(master_path),'sourceROI':[145,976,173,992],'changedBounds':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'transferredPixels':int(mask.sum()),'originalRgbMatchesLockedMaster':True,'destinationRgbaMatchesPriorHand':bool(np.array_equal(images['Braid_Tip'][mask],before['Hand_R'][mask])),'neutralRgbaChangedPixels':0,'sourceMasterChanged':False,'productionApproval':False,'pending':['Actual source/semantic visual review','Source mesh coverage/native atlas reraster if accepted','Actual Pickup wrist contour and braid-tip topology review'],'scriptSha256':sha(Path(__file__))}
    (out/'ownership-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
