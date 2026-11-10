"""Freeze 72 b13 WIP source layers with corrected historical Face provenance."""
from __future__ import annotations
import argparse,copy,hashlib,json,shutil
from pathlib import Path
import numpy as np
from PIL import Image

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def rgba(p):
    a=np.array(Image.open(p).convert('RGBA'));assert a.shape==(1620,971,4);return a

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--arm-metadata',type=Path,required=True);ap.add_argument('--scarf',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    repo=Path(__file__).resolve().parents[3];root=repo/'output/forest-spirit-production-v2/front-v8'
    base=root/'fullbody/provenance/b12-face-r2/fullbody.provenance-corrected.metadata.json'
    assert sha(base)=='3963e76c46e31c4f89f71d04fd735919853f1d666ff0aa3bccc78c41a8f5bfc5'
    arm=args.arm_metadata.resolve();scarf=args.scarf.resolve();out=args.out.resolve();assert out.is_relative_to(repo/'output') and not out.exists()
    for folder in ['layers','source-visible','evidence','qa']:(out/folder).mkdir(parents=True,exist_ok=True)
    meta=copy.deepcopy(read(base));arm_rows={r['id']:r for r in read(arm)['layers']};assert len(meta['layers'])==72
    inherited_path_corrections=[]
    def absolute_existing(value,key=''):
        if isinstance(value,dict):return {k:absolute_existing(v,k) for k,v in value.items()}
        if isinstance(value,list):return [absolute_existing(v,key) for v in value]
        if isinstance(value,str) and value.lower().endswith(('.png','.json')) and key not in {'revisionChain','limitations','notes','scope','status','description'}:
            p=Path(value)
            if p.is_absolute():assert p.is_file(),p;return str(p)
            candidates=[base.parent/p,root/'fullbody/revisions/b12-combined-source-r2'/p,root/'fullbody/revisions/b11'/p]
            found=[c for c in candidates if c.is_file()];assert found,f'Missing inherited reference {key}: {value}'
            if len(found)>1:assert len({sha(c) for c in found})==1
            inherited_path_corrections.append({'field':key,'inheritedReference':value,'resolvedExistingFile':str(found[0]),'sha256':sha(found[0])})
            return str(found[0])
        return value
    meta=absolute_existing(meta)
    input_hashes={str(base):sha(base),str(arm):sha(arm)};before={};after={};changes=[];references=[]
    mutable={'Arm_R_Upper','Arm_R_Lower','Peplum_R','Scarf_Back'}
    for row in meta['layers']:
        name=row['id'];old=Path(row['path']);old=old if old.is_absolute() else base.parent/old
        assert sha(old)==row['sha256'];input_hashes[str(old)]=sha(old);before[name]=rgba(old)
        candidate=old
        if name in mutable-{'Scarf_Back'}:candidate=Path(arm_rows[name]['path']);assert sha(candidate)==arm_rows[name]['sha256']
        if name=='Scarf_Back':candidate=scarf/'Scarf_Back.png';assert sha(candidate)=='12d2e5c653b0714b12bce7c122cff2508d22a83862f795ea0b95bc89001ab2a2'
        input_hashes[str(candidate)]=sha(candidate);after[name]=rgba(candidate)
        delta=np.any(before[name]!=after[name],axis=2);assert bool(delta.any())==(name in mutable)
        target=out/'layers'/f'{name}.png';shutil.copyfile(candidate,target);assert sha(candidate)==sha(target)
        row['path']=target.relative_to(out).as_posix();row['sha256']=sha(target)
        source_visible=Path(arm_rows[name]['sourceVisible']) if name in mutable-{'Scarf_Back'} else Path(row['sourceVisible'])
        source_visible=source_visible if source_visible.is_absolute() else base.parent/source_visible
        assert source_visible.is_file();input_hashes[str(source_visible)]=sha(source_visible)
        visible_target=out/'source-visible'/f'{name}.png';shutil.copyfile(source_visible,visible_target)
        row['sourceVisible']=row['sourceVisiblePath']=visible_target.relative_to(out).as_posix()
        if name in mutable:
            if row.get('mask'):row['priorProductionMaskEvidence']=row['mask']
            if row.get('sourceMask'):row['priorSourceOwnershipMaskEvidence']=row['sourceMask']
            alpha=out/'evidence'/f'{name}-derived-current-production-alpha.png';Image.fromarray(after[name][:,:,3]).save(alpha)
            source_mask=out/'evidence'/f'{name}-derived-current-source-ownership.png';Image.fromarray(rgba(source_visible)[:,:,3]).save(source_mask)
            change_mask=out/'evidence'/f'{name}-b13-rgba-change-mask.png';Image.fromarray(delta.astype(np.uint8)*255).save(change_mask)
            row['mask']=alpha.relative_to(out).as_posix();row['sourceMask']=source_mask.relative_to(out).as_posix();row['activeB13ChangeMask']=change_mask.relative_to(out).as_posix()
            row['status']='b13_source_candidate_pending_native_dynamic_review'
            changes.append({'id':name,'priorSha256':sha(old),'candidateSha256':sha(target),'rgbaChangedPixels':int(delta.sum())})
    # Preserve current corrected Face provenance as evidence; do not invent missing b11 historical masks.
    for label,folder in [('arm-waist',arm.parent),('scarf-corner',scarf)]:
        files=list((folder/'masks').glob('*.png')) if (folder/'masks').is_dir() else list(folder.glob('*mask.png'))
        files += [folder/('source-refinement-report.json' if label=='arm-waist' else 'report.json')]
        for p in files:
            assert p.is_file();target=out/'evidence'/f'{label}-{p.name}';shutil.copyfile(p,target);input_hashes[str(p)]=sha(p);references.append({'path':target.relative_to(out).as_posix(),'sha256':sha(target),'origin':str(p)})
    def composite(images):
        im=Image.new('RGBA',(971,1620))
        for row in sorted(meta['layers'],key=lambda r:r['order']):
            if row.get('visible',True):assert row.get('opacity',1)==1;im.alpha_composite(Image.fromarray(images[row['id']]))
        return im
    a,b=composite(before),composite(after);delta=np.abs(np.array(a).astype(int)-np.array(b).astype(int));assert not delta.any()
    a.save(out/'qa/b12-neutral-source-composite.png');b.save(out/'qa/b13-neutral-source-composite.png')
    for label,color in [('white',(255,255,255,255)),('pale-green',(224,234,216,255)),('deep-green',(24,48,40,255))]:Image.alpha_composite(Image.new('RGBA',b.size,color),b).convert('RGB').save(out/f'qa/b13-neutral-{label}.png')
    meta.update(status='b13_combined_source_WIP_neutral_exact_native_dynamic_pending',productionAccepted=False,modelAccepted=False,artProductionAccepted=False,sourceMasterChanged=False,sourceMergeReport='source-merge-report.json',activeB13Evidence=references)
    meta['revisionChain']+=['b13: 708 original sleeve pixels Upper to Lower; 217 original cuff pixels Peplum_R to Lower; local hidden sleeve continuity/waist outline; 113 hidden Scarf_Back alpha cleanup; inherited corrected Face provenance retained']
    # Every path reference in delivery metadata must resolve; descriptive strings are not paths.
    def validate(value,key=''):
        if isinstance(value,dict):
            for k,v in value.items():validate(v,k)
        elif isinstance(value,list):
            for v in value:validate(v,key)
        elif isinstance(value,str) and value.lower().endswith(('.png','.json')) and key not in {'sourceMergeReport','revisionChain','limitations','notes','scope','status','description'}:
            p=Path(value);p=p if p.is_absolute() else out/p
            assert p.is_file(),f'Missing delivery reference {key}: {value}'
    validate(meta)
    assert all(sha(Path(p))==h for p,h in input_hashes.items())
    mp=out/'fullbody.metadata.json';mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report={'scope':'72 real source layers, WIP; no native rig or dynamic approval','metadataSha256':sha(mp),'baseCorrectedProvenanceMetadata':str(base),'baseCorrectedProvenanceSha256':sha(base),'scriptSha256':sha(Path(__file__)),'changes':changes,'neutralRgbaChangedPixels':0,'allMetadataPathReferencesExist':True,'inheritedRelativePathCorrections':inherited_path_corrections,'inputs':[{'path':p,'sha256':h} for p,h in input_hashes.items()],'sourceInputsUnchanged':True,'sourceMasterChanged':False,'productionAccepted':False}
    (out/'source-merge-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'metadata':str(mp),'sha256':sha(mp),'changes':changes,'neutralRgbaChangedPixels':0}))

if __name__=='__main__':main()
