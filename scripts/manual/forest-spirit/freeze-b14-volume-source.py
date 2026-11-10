"""Freeze the reviewed hidden-RGB volume revision, preserving all source alpha."""
from __future__ import annotations
import argparse, copy, hashlib, json, shutil
from pathlib import Path
import numpy as np
from PIL import Image

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text(encoding="utf-8"))

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--out",type=Path,required=True);a=ap.parse_args()
    repo=Path(__file__).resolve().parents[3];root=repo/"output/forest-spirit-production-v2/front-v8"
    base=root/"fullbody/revisions/b14-combined-source-r1/fullbody.metadata.json";assert sha(base)=="0e02a13c9ca90c24dac74b194dfed6cd3a2d0c9cf6f72b42111fa1d6315b5ad3"
    volume=root/"fullbody/candidates/b14-upper-volume-integrated-r1";v=read(volume/"integration-report.json")
    assert v["allSourceAlphaExact"] and v["allOriginalSourceVisibleRgbaExact"] and v["neutralRgbaChangedPixels"]==0
    out=a.out.resolve();assert out.is_relative_to(repo/"output") and not out.exists()
    for n in ["layers","source-visible","evidence","qa"]:(out/n).mkdir(parents=True,exist_ok=True)
    desc={"revisionChain","limitations","notes","scope","status","description","algorithm"}
    def resolve(x,key=""):
        if isinstance(x,dict):return {k:resolve(v,k) for k,v in x.items()}
        if isinstance(x,list):return [resolve(v,key) for v in x]
        if isinstance(x,str) and x.lower().endswith((".png",".json")) and key not in desc:
            p=(base.parent/x).resolve();assert p.is_file(),p;return str(p)
        return x
    m=resolve(copy.deepcopy(read(base)));before=Image.new("RGBA",(971,1620));after=Image.new("RGBA",before.size)
    inputs={str(base):sha(base),str(volume/"integration-report.json"):sha(volume/"integration-report.json")};changes=[]
    for row in m["layers"]:
        old=Path(row["path"]);candidate=volume/"layers/Arm_R_Upper.png" if row["id"]=="Arm_R_Upper" else old
        assert sha(old)==row["sha256"];inputs[str(old)]=sha(old);inputs[str(candidate)]=sha(candidate)
        x=np.array(Image.open(old).convert("RGBA"));y=np.array(Image.open(candidate).convert("RGBA"));assert np.array_equal(x[:,:,3],y[:,:,3])
        sv=Path(row["sourceVisible"]);source_visible=np.array(Image.open(sv).convert("RGBA"));assert np.array_equal(x[source_visible[:,:,3]>0],y[source_visible[:,:,3]>0])
        if row.get("visible",True):before.alpha_composite(Image.fromarray(x));after.alpha_composite(Image.fromarray(y))
        target=out/"layers"/f"{row['id']}.png";shutil.copyfile(candidate,target);assert sha(target)==sha(candidate)
        svtarget=out/"source-visible"/f"{row['id']}.png";shutil.copyfile(sv,svtarget);inputs[str(sv)]=sha(sv)
        row.update(path=target.relative_to(out).as_posix(),sha256=sha(target),sourceVisible=svtarget.relative_to(out).as_posix(),sourceVisiblePath=svtarget.relative_to(out).as_posix())
        count=int(np.any(x!=y,axis=2).sum())
        if count:
            assert row["id"]=="Arm_R_Upper";changes.append({"id":row["id"],"priorSha256":sha(old),"candidateSha256":sha(target),"rgbChangedPixels":count})
            row["hiddenVolumeLighting"]={"scope":"Generated donor low-frequency luminance only; original weave/color source and all alpha retained","integrationReport":"evidence/upper-volume-integration-report.json","changeMask":"evidence/upper-volume-hidden-rgb-changed.png","allowedMask":"evidence/upper-volume-allowed-hidden-material.png","registrationData":"evidence/upper-volume-luminance-transfer.npz"}
    assert np.array_equal(np.array(before),np.array(after));assert len(changes)==1
    artifacts={volume/"integration-report.json":"upper-volume-integration-report.json",volume/"masks/hidden-rgb-changed.png":"upper-volume-hidden-rgb-changed.png",volume/"masks/allowed-hidden-material.png":"upper-volume-allowed-hidden-material.png",volume/"registration/luminance-transfer.npz":"upper-volume-luminance-transfer.npz",volume/"registration/registered-donor-crop.png":"upper-volume-registered-donor-crop.png",Path(v["generatedDonor"]):"upper-volume-original-generated-donor.png",Path(v["generatedDonor"]).parent/"generation.json":"upper-volume-generation.json"}
    for src,name in artifacts.items():shutil.copyfile(src,out/"evidence"/name);inputs[str(src)]=sha(src)
    before.save(out/"qa/b14-r1-neutral-source-composite.png");after.save(out/"qa/b14-r2-neutral-source-composite.png")
    for n,c in [("white",(255,255,255,255)),("pale-green",(224,234,216,255)),("deep-green",(24,48,40,255))]:Image.alpha_composite(Image.new("RGBA",after.size,c),after).convert("RGB").save(out/"qa"/f"b14-r2-neutral-{n}.png")
    m.update(status="b14_r2_hidden_volume_source_WIP_native73_pending",sourceMergeReport="source-volume-report.json",productionAccepted=False,modelAccepted=False)
    m["revisionChain"]+=["b14 r2: registered generated donor low-frequency lighting only in14213 permitted hidden Upper pixels;12632 RGB pixels changed, all source alpha/original-visible and fullneutralRGBA exact"]
    mp=out/"fullbody.metadata.json";mp.write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    report={"scope":"72-source revision only;73-mesh/native validation separate","sourceMetadata":str(base),"sourceMetadataSha256":sha(base),"metadataSha256":sha(mp),"changes":changes,"all72AlphaExact":True,"allOriginalSourceVisibleExact":True,"neutralRgbaChangedPixels":0,"sourceCoverageGeometryUnchangedByThisRgbOnlyRevision":True,"productionApproval":False,"inputs":[{"path":p,"sha256":h} for p,h in inputs.items()],"inputsUnchanged":all(sha(Path(p))==h for p,h in inputs.items()),"scriptSha256":sha(Path(__file__))}
    assert report["inputsUnchanged"];(out/"source-volume-report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"metadata":str(mp),"sha256":sha(mp),"changes":changes,"neutralRgbaChangedPixels":0}))

if __name__=="__main__":main()
