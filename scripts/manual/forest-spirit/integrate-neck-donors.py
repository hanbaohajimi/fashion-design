"""Registered, masked local donor candidate. No CMO/PSD/master is changed."""
from pathlib import Path
import json,hashlib,shutil
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def resize_premultiplied(path,size):
    a=np.asarray(Image.open(path).convert('RGBA'),dtype=np.float32)/255
    a[...,:3]*=a[...,3:4]
    resized=np.stack([np.asarray(Image.fromarray(a[...,i]).resize(size,Image.Resampling.LANCZOS)) for i in range(4)],axis=-1)
    resized=np.clip(resized,0,1)
    resized[...,:3]=np.divide(resized[...,:3],resized[...,3:4],out=np.zeros_like(resized[...,:3]),where=resized[...,3:4]>1e-6)
    return np.clip(np.rint(resized*255),0,255).astype(np.uint8)
def main():
    base=Path('output/forest-spirit-production-v2/front-v8');out=base/'fullbody/revisions/b12-neck-donor-n1';out.mkdir(parents=True,exist_ok=False)
    for d in ['raw-donors','registered','layers','masks','qa']:(out/d).mkdir()
    request=base/'fullbody/candidates/b12-neck-local-donor-requests-r3'
    generated=Path('C:/Users/朱奕玮/.codex/generated_images/01a1ab2e-73ec-7642-9c8b-1925d42c4358')
    inputs=[('Hair_BackMass','hair-neck-underlap',generated/'exec-2e069504-6eec-4e24-903b-3bd4698518bb.png'),('Scarf_Back','scarf-back-round-wrap',generated/'exec-e5cbba39-bf28-437f-bbb5-d878e11d5fb8.png')]
    meta_path=base/'fullbody/revisions/b11/fullbody-with-r9.metadata.json';meta=json.loads(meta_path.read_text(encoding='utf8'))
    source={x['id']:np.asarray(Image.open(meta_path.parent/x['path']).convert('RGBA')).copy() for x in meta['layers']}
    updated={};reports=[];yy,xx=np.indices((1620,971))
    for name,req,donor_path in inputs:
        reg=json.loads((request/req/'registration.json').read_text(encoding='utf8'));roi=reg['crop'];x0,y0,x1,y1=roi
        retained=out/'raw-donors'/donor_path.name;shutil.copyfile(donor_path,retained);assert sha(retained)==sha(donor_path)
        crop=resize_premultiplied(donor_path,(x1-x0,y1-y0));Image.fromarray(crop).save(out/f'registered/{name}-raw-resized.png')
        c=crop[...,:3].astype(int);a=crop[...,3]
        pollution=((c[...,0]-c[...,1]>65)&(c[...,0]>180))|((c[...,0]>210)&(c[...,1]>160)&(c[...,2]<90))
        valid=(a>=245)&~pollution
        distance,near=distance_transform_edt(~valid,return_indices=True)
        cleaned=crop.copy();cleaned[...,:3]=crop[near[0],near[1],:3]
        Image.fromarray(cleaned).save(out/f'registered/{name}-clean-interior-colors.png')
        full=np.zeros((1620,971,4),dtype=np.uint8);full[y0:y1,x0:x1]=cleaned
        support=np.zeros((1620,971),dtype=bool);support[y0:y1,x0:x1]=distance<=8
        allowed=np.asarray(Image.open(request/req/'allowed-hidden-mask-full-971x1620.png').convert('L'))>0
        if name=='Scarf_Back':allowed&=(xx<380)|(xx>665) # exposeable side material only, original centre retained
        old=source[name];new=old.copy();blend=np.clip(distance_transform_edt(allowed)/2,0,1)*support
        if name=='Hair_BackMass':
            # Fill concealed underlap using only the fixed allowed mask. Edge RGB comes from
            # clean donor interiors; no original visible or exterior source pixel is changed.
            old_alpha=old[...,3].astype(float)/255
            alpha=old_alpha+(1-old_alpha)*blend
            premul=old[...,:3]*old_alpha[...,None]*(1-blend[...,None])+full[...,:3]*blend[...,None]
            new[...,:3]=np.clip(np.rint(np.divide(premul,alpha[...,None],out=np.zeros_like(premul),where=alpha[...,None]>0)),0,255).astype(np.uint8)
            new[...,3]=np.rint(alpha*255).astype(np.uint8)
            new[~allowed]=old[~allowed]
        else:
            new[...,:3]=np.rint(old[...,:3]*(1-blend[...,None])+full[...,:3]*blend[...,None]).astype(np.uint8)
            alpha_shape=np.asarray(Image.open(base/'fullbody/revisions/b12-scarf-s2/layers/Scarf_Back.png').convert('RGBA'))[...,3]
            new[...,3]=alpha_shape
        changed=np.any(new!=old,axis=2)
        alpha_removed=(old[...,3]>new[...,3]) if name=='Scarf_Back' else np.zeros_like(allowed)
        assert not np.any(changed&~(allowed|alpha_removed))
        source_visible=np.asarray(Image.open(meta_path.parent/next(x['sourceVisiblePath'] for x in meta['layers'] if x['id']==name)).convert('RGBA'))[...,3]>0
        assert not np.any(changed&source_visible)
        Image.fromarray(new).save(out/f'layers/{name}.png');Image.fromarray(changed.astype(np.uint8)*255).save(out/f'masks/{name}-all-changes.png');Image.fromarray((allowed&support).astype(np.uint8)*255).save(out/f'masks/{name}-donor-colour-mask.png');Image.fromarray(alpha_removed.astype(np.uint8)*255).save(out/f'masks/{name}-hidden-alpha-removal.png');Image.fromarray((pollution|(a<245)).astype(np.uint8)*255).save(out/f'masks/{name}-donor-rejected-border-crop.png')
        updated[name]=new
        reports.append({'layerId':name,'rawDonor':str(retained.resolve()),'rawDonorSha256':sha(retained),'rawDonorSize':list(Image.open(donor_path).size),'registrationCrop':roi,'registrationScale':[480/Image.open(donor_path).width,250/Image.open(donor_path).height],'mapping':'Fixed complete-frame resize to480x250 then translate300,550; no optical/image fit','allowedMaskSha256':reg['maskSha256'],'actualDonorColourPixels':int(np.count_nonzero(allowed&support)),'allowedUnsupportedPixels':int(np.count_nonzero(allowed&~support)),'changedRgbaPixels':int(changed.sum()),'sourceVisibleChangedPixels':int(np.count_nonzero(changed&source_visible)),'outsideExplicitMasksChangedPixels':int(np.count_nonzero(changed&~(allowed|alpha_removed))),'hiddenAlphaRemovalPixels':int(alpha_removed.sum()),'outputSha256':sha(out/f'layers/{name}.png')})
    def composite(replacement):
        image=Image.new('RGBA',(971,1620))
        for x in sorted(meta['layers'],key=lambda v:v['order']):
            if not x.get('visible',True):continue
            p=replacement.get(x['id'],source[x['id']]).copy();p[...,3]=np.rint(p[...,3]*x.get('opacity',1)).astype(np.uint8);image=Image.alpha_composite(image,Image.fromarray(p))
        return image
    before=composite({});after=composite(updated);Image.Image.save(after,out/'qa/72-part-neutral-candidate.png')
    unchanged=np.array_equal(np.asarray(before),np.asarray(after))
    report={'scope':'Masked donor production-art candidate only; no model/PSD/Core acceptance','baseMetadataSha256':sha(meta_path),'donors':reports,'neutralRgbaExactlyUnchanged':unchanged,'nativeModelWritten':False,'productionApproval':False,'remaining':['Added Hair_BackMass alpha must get local source mesh coverage before real native export','Retained local transition and scarf-back head/neck boundary require actual Core dynamic checks','Donor side texture matches require human visual review at worst endpoints']}
    (out/'donor-integration-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps(report,indent=2));assert unchanged
if __name__=='__main__':main()
