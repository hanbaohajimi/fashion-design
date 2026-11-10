"""Read-only source/PSD identity audit of an actual unbound Cubism PSD import."""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path
import numpy as np
from PIL import Image

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inspection',type=Path,required=True);ap.add_argument('--metadata',type=Path,required=True);ap.add_argument('--psd-report',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    assert not a.out.exists();j=read(a.inspection);m=read(a.metadata);p=read(a.psd_report)
    files={str(x.resolve()):sha(x) for x in [a.inspection,a.metadata,a.psd_report,Path(j['source'])]}
    rows={r['id']:r for r in m['layers']};tiles={r['name']:r for r in j['atlasTiles']};draw={r['id']:r for r in j['drawables']};psd={r['id']:r for r in p['layers']}
    checks={'72LayerIdsExact':len(rows)==72 and set(rows)==set(tiles)==set(draw)==set(psd),'canvas971x1620':j['canvas']['width']==971 and j['canvas']['height']==1620,'nativeSourceUnchanged':sha(Path(j['source']))==j['sourceSha256'],'importOnlyUnbound':j['counts']['parameters']==27 and j['counts']['deformers']==0 and j['counts']['atlasPages']==0}
    details=[]
    for id,row in rows.items():
        expected=a.metadata.parent/row['path'];actual=Path(tiles[id]['extractedSourcePng']);files[str(expected.resolve())]=sha(expected);files[str(actual)]=sha(actual)
        x=np.array(Image.open(expected).convert('RGBA'));y=np.array(Image.open(actual).convert('RGBA'));equal=x.shape==y.shape==(1620,971,4) and np.array_equal(x,y)
        digest=hashlib.sha256(y.tobytes()).hexdigest()
        details.append({'id':id,'sourcePngSha256':sha(expected),'nativePngSha256':sha(actual),'rgbaExact':equal,'nativeRgbaSha256':digest,'psdRgbaExact':digest==psd[id]['rgbaSha256'],'canvasTransform':tiles[id]['canvasTransform'],'visibilityMatches':draw[id]['visible']==row.get('visible',True),'opacityMatches':draw[id]['opacity']==row.get('opacity',1)})
        assert sha(expected)==row['sha256'] and sha(actual)==tiles[id]['sourcePngSha256']
    checks['72RgbaExact']=all(r['rgbaExact'] and r['psdRgbaExact'] for r in details)
    checks['unitSourceTransforms']=all(r['canvasTransform']==[1.,0.,0.,0.,1.,0.] for r in details)
    checks['visibilityOpacityExact']=all(r['visibilityMatches'] and r['opacityMatches'] for r in details)
    groups={g['id']:re.findall(r'DrawableId\(raw=([^)]*)\)',g['children']) for g in j['parts']}
    expected_groups={g:[r['id'] for r in reversed(m['layers']) if r['group']==g] for g in {r['group'] for r in m['layers']}}
    checks['16GroupMembershipAndNativeOrderExact']=len(groups)==16 and groups==expected_groups and [g['id'] for g in j['parts']]==p['expectedCubismFrontToBackGroups']
    checks['allInputsUnchanged']=all(sha(Path(name))==h for name,h in files.items())
    report={'scope':'Actual native PSD import-only source RGBA and group readback; not a bound production model','source':j['source'],'sourceSha256':j['sourceSha256'],'metadata':str(a.metadata.resolve()),'metadataSha256':sha(a.metadata),'psdReadbackReport':str(a.psd_report.resolve()),'passed':all(checks.values()),'checks':checks,'counts':j['counts'],'canvas':j['canvas'],'groups':groups,'layers':details,'inputHashes':files,'productionApproval':False,'modelBindingAcceptance':'not_applicable_import_only'}
    a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'report':str(a.out),'checks':checks,'sourceSha256':j['sourceSha256']}));assert all(checks.values())

if __name__=='__main__':main()
