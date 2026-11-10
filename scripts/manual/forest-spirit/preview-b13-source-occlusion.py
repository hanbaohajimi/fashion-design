"""Offline source/occlusion hypothesis from fixed actual Core poses, not Core acceptance."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--metadata',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--roi',type=int,nargs=4,default=[110,770,440,1100]);ap.add_argument('--clip-ids',nargs='+',default=['Cape_R']);ap.add_argument('--states',nargs='+',default=['axis-ParamFSPickup-maximum','hat-8-head0-e1','hat-16-head0-e1']);ap.add_argument('--baseline',type=Path);ap.add_argument('--geometry',type=Path);ap.add_argument('--captures',type=Path);args=ap.parse_args()
    root=Path(__file__).resolve().parents[3]/'output/forest-spirit-production-v2/front-v8'
    baseline=args.baseline or root/'fullbody/revisions/b12-combined-source-r2/fullbody.metadata.json'
    geometry=args.geometry or root/'validation/full-b12-native-repair-r9-audit-r1/native-source-geometry.json'
    native=json.loads(geometry.read_text(encoding='utf-8'));geom={d['id']:d for d in native['drawables']}
    metas=[json.loads(p.read_text(encoding='utf-8')) for p in [baseline,args.metadata]]
    images=[]
    for meta,mp in zip(metas,[baseline,args.metadata]):images.append({r['id']:np.array(Image.open(mp.parent/r['path']).convert('RGBA')) for r in meta['layers']})
    assert not args.out.exists();args.out.mkdir(parents=True)
    roi=args.roi;x0,y0,x1,y1=roi;w,h=x1-x0,y1-y0;yy,xx=np.mgrid[y0:y1,x0:x1];points=np.stack((xx+.5,yy+.5,np.ones_like(xx)),axis=2)
    reports=[]
    for name in args.states:
        cp=args.captures or root/'validation/full-b12-repair-r9-parameter-matrix-r1';state=json.loads((cp/(name+'.json')).read_text(encoding='utf-8'));cache=[];residuals={}
        for d in state['drawables']:
            if d['opacity']<=0:continue
            src=np.array(geom[d['id']]['positions'],dtype=np.float32).astype(float).reshape(-1,2);world=np.array(d['vertexPositions']).reshape(-1,2);world[:,0]=world[:,0]*971+485.5;world[:,1]=810-world[:,1]*971
            if world[:,0].max()<x0-80 or world[:,0].min()>x1+80 or world[:,1].max()<y0-80 or world[:,1].min()>y1+80:continue
            matrix=np.linalg.lstsq(np.column_stack((src,np.ones(len(src)))),world,rcond=None)[0];error=np.max(np.abs(np.column_stack((src,np.ones(len(src))))@matrix-world));residuals[d['id']]=float(error)
            if error<=.001:
                affine=np.eye(3);affine[:2,:]=matrix.T;inverse=np.linalg.inv(affine);samples=points@inverse.T
            else:
                assert d['id'] not in {'Arm_R_Upper','Arm_R_Lower','Peplum_R'},'Changed source needs exact native mapping'
                samples=np.full((h,w,3),-999.)
                for tri in np.asarray(d['vertexIndices']).reshape(-1,3):
                    a,b,c=world[tri];eb,ec=b-a,c-a;det=eb[0]*ec[1]-eb[1]*ec[0]
                    assert abs(det)>1e-6
                    v=((points[:,:,0]-a[0])*ec[1]-(points[:,:,1]-a[1])*ec[0])/det;z=((points[:,:,1]-a[1])*eb[0]-(points[:,:,0]-a[0])*eb[1])/det
                    mask=(v>=-1e-7)&(z>=-1e-7)&(v+z<=1+1e-7);sa,sb,sc=src[tri];q=sa+v[:,:,None]*(sb-sa)+z[:,:,None]*(sc-sa);samples[mask,:2]=q[mask]
            coords=[samples[:,:,1]-.5,samples[:,:,0]-.5]
            pair=[]
            for source_images in images:
                source=source_images[d['id']];alpha=map_coordinates(source[:,:,3].astype(float)/255,coords,order=1,mode='constant',cval=0)*d['opacity'];rgba=np.zeros((h,w,4));rgba[:,:,3]=alpha
                for channel in range(3):rgba[:,:,channel]=map_coordinates(source[:,:,channel].astype(float)*source[:,:,3]/255,coords,order=1,mode='constant',cval=0)*d['opacity']
                pair.append(rgba)
            cache.append((d,pair))
        def composite(which,inverse_clip=False,promote=False):
            order=sorted(cache,key=lambda item:item[0]['renderOrder']);unclipped=np.ones((h,w))
            for d,pair in cache:
                if d['id'] in args.clip_ids:unclipped*=1-pair[which][:,:,3]
            cape=1-unclipped;hat=state['parameters']['ParamFSHatTouch']
            if (inverse_clip or promote) and hat>=.45:
                highest_static=max(d['renderOrder'] for d,_ in cache if d['id'] not in {'Arm_R_Upper','Arm_R_Lower','Hand_R'})
                order=sorted(cache,key=lambda item:highest_static+.5 if item[0]['id']=='Arm_R_Upper' else item[0]['renderOrder'])
            result=np.zeros((h,w,4))
            for d,pair in order:
                rgba=pair[which].copy()
                if inverse_clip and d['id']=='Arm_R_Upper':rgba*=1-cape[:,:,None]
                a=rgba[:,:,3];result[:,:,:3]=rgba[:,:,:3]+result[:,:,:3]*(1-a[:,:,None]);result[:,:,3]=a+result[:,:,3]*(1-a)
            bg=np.array([224.,234.,216.]);return Image.fromarray(np.clip(np.rint(result[:,:,:3]+bg*(1-result[:,:,3,None])),0,255).astype(np.uint8))
        actual=Image.open(cp/(name+'.png')).convert('RGBA').crop(roi);actual=Image.alpha_composite(Image.new('RGBA',(w,h),(224,234,216,255)),actual).convert('RGB')
        panels=[actual,composite(0),composite(1),composite(1,True),composite(1,False,True)];labels=['ACTUAL source Core capture','CPU baseline reconstruction','CPU source hypothesis','REJECTED mask/order hypothesis','REJECTED order hypothesis']
        sheet=Image.new('RGB',(w*len(panels),h+28),'white');dr=ImageDraw.Draw(sheet)
        for i,(p,label) in enumerate(zip(panels,labels)):sheet.paste(p,(i*w,28));dr.text((i*w+2,8),label,fill='black');p.save(args.out/f'{name}-{i}.png')
        sheet.save(args.out/f'{name}-comparison.png')
        diff=np.abs(np.array(actual).astype(int)-np.array(panels[1]).astype(int))
        clip_diff=np.abs(np.array(panels[2]).astype(int)-np.array(panels[3]).astype(int));Image.fromarray(np.clip(clip_diff*8,0,255).astype(np.uint8)).save(args.out/f'{name}-clip-difference-x8.png')
        owner=np.full((h,w),-1,dtype=int);ids=[];upper=None;unclipped=np.ones((h,w));upper_order=next(d['renderOrder'] for d,_ in cache if d['id']=='Arm_R_Upper')
        for d,pair in sorted(cache,key=lambda item:item[0]['renderOrder']):
            ids.append(d['id']);owner[pair[0][:,:,3]>.5]=len(ids)-1
            if d['id']=='Arm_R_Upper':upper=pair[1][:,:,3]
            if d['id'] in args.clip_ids:unclipped*=1-pair[1][:,:,3]
        exposed=(upper*unclipped)>.5;counts={name:int(np.count_nonzero(exposed&(owner==i))) for i,name in enumerate(ids) if name not in args.clip_ids+['Arm_R_Upper','Arm_R_Lower','Hand_R']};counts={k:v for k,v in counts.items() if v}
        reports.append({'state':name,'roi':roi,'sourceToActualCoreAffineResidualsPx':residuals,'actualVsCpuReconstructionRgbMae':float(diff.mean()),'actualVsCpuReconstructionRgbMaximum':int(diff.max()),'candidateClipOrderVsSourceRgbChangedPixels':int(np.any(clip_diff,axis=2).sum()),'candidateClipOrderVsSourceRgbMax':int(clip_diff.max()),'potentialPromotedUpperOriginalTopOwners':counts,'candidatePanelsAreNotActualCore':True})
    (args.out/'hypothesis-report.json').write_text(json.dumps({'scope':'Offline pixel source hypotheses. Actual source-capture geometry is measured; candidate sources and speculative clipping have NOT been exported/evaluated by Core.','baselineMetadata':str(baseline),'candidateMetadata':str(args.metadata),'geometry':str(geometry),'captures':str(cp),'clipIds':args.clip_ids,'states':reports,'productionApproval':False},indent=2)+'\n',encoding='utf-8');print(args.out)


if __name__=='__main__':main()
