"""Source-pixel separation of the locked frontal v8 body, hair, hat and tools.

No image generation, source overwrite, fake hidden extraction or model export.
Visible ownership and locally reconstructed occlusions are separate evidence.
The result is work in progress until each isolated contour and posed overlap is
reviewed. A neutral reconstruction match is not a production/animation pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from scipy.ndimage import distance_transform_edt, binary_closing, label
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "output/forest-spirit-production-v2/front-view-candidates/v8/forest-spirit-frontal-candidate-v8.png"
FACE = ROOT / "output/forest-spirit-production-v2/front-v8/face/revisions/r9"
SPEC = ROOT / "doc/design/forest-spirit/production/front-v8/layers.json"
SHA = "da5225e2451d062c5b8c21aea47b236d9d2d1b1b9cc6570942b854f8b775e02e"
W, H = 971, 1620
PARTS = []


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def blank():
    return Image.new("L", (W, H))


def poly(points):
    m = blank(); ImageDraw.Draw(m).polygon(points, fill=255); return m


def ellipse(box):
    m = blank(); ImageDraw.Draw(m).ellipse(box, fill=255); return m


def line(points, width):
    m = blank(); ImageDraw.Draw(m).line(points, fill=255, width=width, joint="curve"); return m


def union(*masks):
    r = blank()
    for m in masks: r = ImageChops.lighter(r, m)
    return r


def inter(*masks):
    r = Image.new("L", (W, H), 255)
    for m in masks: r = ImageChops.darker(r, m)
    return r


def sub(a, b):
    return ImageChops.subtract(a, b)


def binmask(m):
    return m.point(lambda p: 255 if p else 0)


def add(name, order, points=None, *, mask=None, donor=None, support=None, notes="", hidden=False, group=None):
    candidate = mask if mask is not None else poly(points)
    PARTS.append(dict(id=name, order=order, candidate=blank() if hidden else candidate,
                      complete=support if support is not None else candidate,
                      donor=donor, notes=notes, hidden=hidden, group=group))


def define_parts():
    # Anatomical L is viewer right. Geometry follows actual v8, not old side view.
    add("Hair_BackMass", 100, [(121,388),(183,314),(303,299),(456,287),(621,294),(766,322),(834,387),(870,480),(894,534),(894,605),(870,645),(811,675),(762,691),(774,728),(719,753),(684,723),(655,688),(375,665),(331,715),(272,743),(211,703),(161,660),(137,612),(144,563),(122,531)], donor=(786,581,808,614), notes="Back hair volume; front-lock and braid occlusions remain separate. Hidden roots need directional strand repair before large yaw.")
    add("Braid_Root", 111, [(247,613),(292,606),(329,616),(366,640),(365,680),(345,716),(310,751),(279,775),(232,785),(194,764),(177,733),(171,700),(187,670),(217,645)], donor=(262,673,292,701), notes="Viewer-left braid root; upper overlap with side hair is locally filled, not a rigid extension of the entire head.")
    add("Braid_Mid", 112, [(255,732),(299,734),(320,751),(309,777),(283,805),(252,837),(238,858),(194,856),(175,827),(176,794),(187,762),(214,742)], donor=(208,777,230,804), notes="Braid middle remains distinct from root/tip; follow attenuation and bend belong to actual Cubism deformers.")
    add("Braid_Tip", 113, [(184,853),(236,863),(245,881),(223,905),(206,935),(191,959),(168,981),(145,975),(133,956),(128,923),(132,894),(153,872)], donor=(156,904,175,932))
    add("Hair_BraidTie", 114, [(179,833),(193,833),(215,840),(240,847),(255,850),(259,859),(251,872),(235,875),(214,869),(193,866),(176,859),(174,849)], donor=(198,847,218,859), notes="Only the existing short green braided tie, no flower or added ribbon.")

    add("Hat_BackInner", 120, mask=union(poly([(129,402),(179,390),(242,374),(237,414),(209,463),(185,507),(169,522),(147,512),(130,491),(122,463),(121,437)]),poly([(787,355),(831,365),(864,391),(883,416),(885,451),(873,478),(851,495),(837,481),(823,447),(814,416)])), donor=(841,420,858,447), notes="Original brown inner lining, not the stale plan label terracotta. Concealed inner band requires review if exposed.")

    add("Body_Base", 200, [(395,702),(620,701),(687,772),(702,940),(656,1025),(364,1026),(325,942),(343,786)], donor=(354,1267,388,1291), hidden=True, notes="Fully garment-occluded body support, locally reconstructed cloth; no visible-source body claim or validated arm-raising anatomy.")
    add("Cape_Back", 210, [(351,711),(414,691),(602,691),(674,710),(741,766),(753,838),(680,888),(353,890),(282,830),(307,757)], donor=(374,778,402,807), notes="Mostly hidden cape support; only the real center neckline may remain visible. Directional folds under shoulders need pose review.")

    add("Sock_R", 300, [(320,1218),(468,1220),(474,1291),(482,1312),(481,1355),(475,1381),(315,1382),(304,1345),(307,1307),(324,1290)], donor=(340,1267,386,1292))
    add("Sock_L", 301, [(519,1220),(665,1217),(665,1287),(679,1303),(678,1349),(670,1382),(513,1382),(503,1353),(502,1308),(518,1293)], donor=(556,1267,605,1292))
    add("Boot_R", 310, [(307,1350),(464,1350),(486,1390),(490,1439),(497,1490),(496,1547),(482,1577),(444,1590),(339,1588),(306,1573),(286,1549),(286,1513),(296,1457)], donor=(363,1477,403,1516))
    add("Boot_L", 311, [(524,1351),(669,1351),(692,1381),(700,1433),(708,1479),(709,1536),(701,1568),(672,1584),(555,1588),(518,1578),(497,1555),(495,1513),(506,1449)], donor=(566,1478,609,1517))
    add("Boot_Cuff_R", 320, [(304,1353),(327,1358),(374,1368),(424,1368),(467,1357),(482,1363),(491,1401),(490,1429),(480,1445),(450,1450),(414,1446),(380,1448),(346,1446),(315,1447),(296,1437),(289,1415),(292,1385)], donor=(313,1384,334,1403))
    add("Boot_Cuff_L", 321, [(514,1356),(548,1368),(598,1370),(649,1365),(677,1356),(692,1362),(702,1391),(708,1424),(698,1444),(675,1450),(639,1446),(607,1448),(570,1446),(539,1448),(517,1441),(503,1422),(501,1390)], donor=(537,1385,558,1406))

    add("Skirt_Base", 400, [(330,985),(665,987),(749,1072),(853,1164),(858,1201),(791,1237),(694,1253),(587,1261),(478,1267),(372,1257),(268,1244),(188,1224),(145,1198),(153,1153),(243,1064)], donor=(351,1124,381,1157), notes="Linen underskirt support remains behind checked panel and all four petals; keep lace transparency and skirt silhouette.")
    add("Lace_Hem", 410, [(149,1174),(210,1182),(280,1198),(348,1208),(421,1218),(501,1222),(576,1220),(651,1214),(721,1206),(791,1192),(849,1178),(861,1201),(855,1217),(837,1225),(809,1230),(782,1240),(745,1244),(719,1250),(685,1247),(656,1257),(621,1254),(591,1263),(553,1259),(519,1268),(489,1260),(459,1266),(424,1257),(391,1262),(361,1251),(330,1255),(300,1246),(272,1246),(241,1237),(211,1234),(180,1226),(158,1220),(144,1206)], donor=(376,1230,407,1241), notes="Source lace holes preserve original alpha; no opaque polygon fill across holes.")
    add("Skirt_CheckPanel", 420, [(415,1005),(538,1006),(548,1063),(573,1141),(620,1208),(587,1225),(535,1231),(468,1231),(413,1225),(367,1211),(387,1143),(404,1060)], donor=(455,1130,488,1180), notes="Brown low-contrast plaid belongs to this cloth panel, not separate floating decoration.")
    add("Skirt_Petal_Side_R", 430, [(285,987),(372,999),(381,1030),(345,1081),(300,1131),(248,1174),(207,1192),(176,1193),(151,1182),(141,1163),(147,1142),(180,1097),(220,1051)], donor=(216,1101,248,1129))
    add("Skirt_Petal_Side_L", 431, [(625,996),(701,1002),(747,1040),(798,1093),(841,1140),(860,1168),(852,1185),(831,1195),(802,1196),(768,1185),(730,1163),(686,1121),(651,1075)], donor=(771,1112,799,1140))
    add("Skirt_Petal_Front_R", 440, [(364,1004),(443,1011),(451,1056),(439,1098),(421,1149),(399,1190),(372,1213),(342,1225),(310,1223),(282,1213),(264,1196),(263,1174),(283,1134),(309,1084),(336,1037)], donor=(341,1116,372,1152), notes="Green piping remains original pixels attached to the front-left-view petal.")
    add("Skirt_Petal_Front_L", 441, [(503,1015),(581,1007),(616,1031),(649,1077),(682,1128),(707,1170),(706,1196),(690,1215),(661,1227),(629,1228),(599,1217),(572,1195),(551,1164),(532,1122),(514,1073)], donor=(590,1104,620,1143), notes="Green piping remains original pixels attached to the front-right-view petal.")

    add("Arm_R_Upper", 500, [(279,800),(345,821),(365,859),(340,901),(310,941),(263,964),(202,930),(196,889),(225,838)], donor=(251,900,275,927), notes="Upper/lower split follows planned elbow contour, not an asserted visible sewn joint; shoulder under cape is local extension.")
    add("Arm_R_Lower", 501, [(210,894),(265,925),(312,943),(283,982),(264,1007),(245,1018),(216,999),(188,986),(168,974),(162,959),(175,932)], donor=(239,942,258,966))
    add("Hand_R", 502, [(169,969),(191,973),(220,985),(244,1003),(250,1017),(237,1044),(213,1065),(188,1077),(166,1074),(150,1060),(140,1044),(141,1019),(151,992)], donor=(170,1014,196,1041))
    add("Arm_L_Upper", 510, [(739,806),(802,824),(836,862),(866,902),(883,938),(861,969),(807,963),(770,919),(751,867)], donor=(835,903,856,927), notes="Shoulder is mostly hidden by cape and pouch; local sleeve patch needs raise-arm review.")
    add("Arm_L_Lower", 511, [(812,922),(856,937),(890,943),(904,960),(903,978),(889,991),(866,999),(845,1017),(825,1008),(801,980)], donor=(854,941,871,955))
    add("Hand_L", 512, [(850,988),(872,975),(892,977),(907,994),(916,1017),(922,1046),(913,1068),(891,1080),(869,1080),(848,1066),(831,1043),(822,1023)], donor=(864,1013,891,1045))

    add("Bodice_Olive", 600, [(374,736),(599,736),(660,786),(665,899),(627,943),(356,942),(326,899),(340,803)], donor=(463,856,490,892))
    add("Peplum_R", 610, [(331,917),(440,932),(427,972),(416,1010),(396,1036),(374,1048),(347,1048),(325,1036),(312,1018),(287,1029),(265,1031),(247,1025),(244,1014),(266,987),(296,945)], donor=(353,965,377,993), notes="Owns exactly two viewer-left green lobes, with the outer lobe behind sleeve. Two-lobe shape retained.")
    add("Peplum_Center", 611, [(438,935),(500,938),(511,970),(513,1005),(503,1034),(484,1054),(463,1063),(443,1059),(425,1048),(413,1032),(416,1001),(427,965)], donor=(448,973,477,1006), notes="Owns the one central lobe; five total across three Peplum IDs.")
    add("Peplum_L", 612, [(501,935),(613,919),(637,943),(657,975),(677,1013),(670,1032),(646,1033),(621,1021),(610,1009),(599,1033),(580,1048),(557,1054),(535,1049),(516,1036),(507,1016),(506,982)], donor=(538,968,562,996), notes="Owns exactly two viewer-right green lobes; outer lobe is partly covered by pouch and needs local continuation.")
    add("Cape_R", 620, [(356,708),(392,707),(421,722),(447,748),(460,778),(457,810),(446,839),(428,856),(401,872),(373,884),(337,887),(304,881),(275,869),(252,853),(253,835),(273,807),(296,775),(323,742)], donor=(354,779,389,812))
    add("Cape_L", 621, [(603,720),(637,707),(669,713),(698,734),(725,762),(751,789),(785,815),(818,838),(837,855),(835,871),(817,880),(792,883),(765,877),(735,868),(707,851),(678,828),(653,797),(630,769),(614,744)], donor=(651,753,677,779))
    add("Chest_Button", 630, mask=ellipse((517,780,584,843)), donor=(533,791,548,804))

    add("Hair_Bangs_Center", 1100, [(445,315),(503,308),(566,313),(603,328),(582,361),(556,391),(525,413),(491,431),(454,442),(420,445),(421,428),(451,411),(475,387),(489,360),(484,342),(464,344),(438,365),(414,389),(391,411),(365,427),(342,436),(343,418),(373,382),(403,348)], donor=(513,360,535,386))
    add("Hair_Bangs_R", 1101, [(238,370),(287,350),(341,340),(402,328),(453,325),(451,348),(421,379),(384,405),(349,432),(309,457),(278,479),(250,482),(230,472),(220,456),(232,441),(265,435),(288,421),(311,395),(284,408),(260,410),(237,401)], donor=(309,402,332,420))
    add("Hair_Bangs_L", 1102, [(592,317),(639,326),(687,340),(735,354),(777,373),(796,405),(812,438),(814,458),(801,473),(777,480),(745,471),(713,454),(684,437),(658,410),(638,378),(618,353)], donor=(737,418,757,442))
    add("Hair_Side_R", 1103, [(235,439),(277,447),(314,442),(344,433),(350,456),(345,489),(350,533),(367,569),(383,596),(374,617),(357,632),(333,633),(311,622),(291,600),(277,573),(270,537),(257,507),(247,527),(222,547),(197,548),(166,545),(143,541),(130,526),(133,512),(146,513),(160,520),(183,513),(204,493),(224,467)], donor=(304,539,325,568))
    add("Hair_Side_L", 1104, [(699,438),(729,443),(763,454),(791,479),(812,501),(834,519),(857,523),(875,510),(884,514),(888,532),(880,548),(859,560),(830,560),(810,552),(795,539),(795,574),(785,600),(763,627),(740,644),(715,650),(689,641),(662,625),(659,606),(676,588),(695,569),(705,542),(707,505)], donor=(746,555,768,585))

    add("Hat_Brim_Back", 1200, [(392,101),(414,85),(449,75),(486,71),(521,74),(554,83),(581,98),(599,117),(557,117),(516,105),(469,101),(426,113)], donor=(461,82,484,91), notes="Actual narrow rear cap band only; the unseen annulus is locally extended underneath dome, not claimed extracted.")
    add("Hat_Dome", 1210, [(181,347),(184,280),(204,222),(242,167),(300,129),(365,112),(417,103),(454,98),(506,98),(561,103),(614,118),(663,139),(708,164),(744,197),(774,239),(788,278),(789,313),(736,319),(673,301),(604,292),(549,288),(491,287),(435,295),(382,307),(322,323),(261,346),(213,369)], donor=(502,177,545,224), notes="Dome continuation behind leaves/acorns and front brim is masked local hat texture; seam continuation needs manual inspection.")
    add("Hat_Brim_Front", 1220, [(191,267),(231,276),(276,270),(324,262),(370,261),(414,259),(458,256),(510,255),(551,255),(591,258),(635,262),(674,267),(713,277),(755,290),(787,306),(807,325),(825,344),(848,361),(868,379),(878,395),(868,402),(847,395),(825,386),(805,370),(787,356),(774,354),(750,353),(729,346),(708,334),(695,323),(679,330),(657,333),(637,331),(614,324),(595,309),(581,316),(556,327),(533,330),(510,329),(486,320),(466,307),(449,309),(433,325),(412,337),(389,344),(368,348),(347,344),(329,338),(310,354),(289,367),(267,377),(245,379),(228,374),(212,390),(195,407),(178,420),(158,426),(139,425),(125,420),(132,402),(146,384),(161,359),(176,327)], donor=(493,278,519,301))
    add("Hat_Leaves", 1230, [(194,211),(202,194),(225,181),(245,181),(245,168),(259,159),(277,161),(289,172),(301,162),(293,145),(293,130),(302,116),(320,114),(328,102),(345,93),(361,98),(374,112),(378,129),(389,133),(394,147),(383,161),(374,173),(364,183),(348,196),(336,211),(325,233),(311,252),(294,269),(278,278),(259,273),(248,263),(232,275),(215,279),(198,270),(193,258),(201,242),(211,231),(199,226)], donor=(260,210,280,232))
    add("Hat_Acorns", 1240, mask=union(poly([(301,226),(307,215),(319,209),(321,195),(334,188),(350,190),(359,202),(362,218),(359,239),(361,254),(351,270),(335,278),(320,270),(309,256),(305,243)]),poly([(353,193),(361,181),(373,175),(390,176),(402,183),(412,196),(412,210),(412,224),(403,242),(391,249),(378,248),(367,239),(360,223),(359,211)]),line([(337,202),(351,183),(372,171)],8)), donor=(374,214,388,232))
    add("Hat_Berries", 1250, mask=union(ellipse((397,131,420,154)),ellipse((422,131,445,154)),ellipse((437,151,459,174)),line([(407,148),(401,177),(386,193)],5),line([(434,147),(415,171),(390,190)],5),line([(446,166),(421,179),(393,190)],5)), donor=(405,137,412,146), notes="All three original red berries and stems, no added flower or bell.")

    add("Pouch_Strap", 1300, [(413,716),(437,724),(458,741),(482,767),(505,795),(533,827),(560,855),(585,881),(611,911),(625,934),(618,947),(601,951),(589,937),(571,911),(544,882),(516,853),(490,824),(463,793),(440,765),(423,742)], donor=(468,780,479,792), notes="Original diagonal strap including buckle; must not be copied into bodice or button independently.")
    add("Pouch_Back", 1310, [(601,886),(635,885),(668,890),(702,895),(740,900),(772,904),(795,913),(804,933),(802,966),(792,1018),(773,1059),(749,1074),(700,1081),(650,1073),(623,1058),(610,1026),(603,976)], donor=(710,984,744,1013), notes="Visible rolled back lip and concealed pouch support locally reconstructed; tools extend behind the separate front panel.")
    add("Tool_Roll_A", 1320, [(730,738),(736,727),(752,724),(770,727),(781,736),(780,750),(767,789),(754,838),(741,884),(731,913),(692,908),(701,863),(713,816),(724,771)], donor=(732,780,745,807), notes="Viewer-left tall rear roll, including its existing opening. Hidden lower continuation only.")
    add("Tool_Roll_B", 1321, [(773,749),(781,739),(798,739),(815,744),(825,753),(821,769),(803,810),(788,851),(777,898),(765,921),(731,918),(739,878),(750,833),(762,789)], donor=(781,786,796,816))
    add("Tool_Roll_C", 1322, [(749,838),(760,826),(775,826),(793,832),(804,842),(806,852),(793,884),(784,910),(777,920),(740,918),(731,908),(735,880)], donor=(755,865,770,890), notes="Distinct short front roll; preserve its lower mouth and all three-roll overlap.")
    # Scissor loop holes must not carry sleeve/paper/background pixels.
    scissors = union(ellipse((590,804,660,886)),ellipse((652,784,724,859)),poly([(619,863),(644,858),(663,900),(648,911),(636,895)]),poly([(675,840),(697,847),(686,900),(669,906),(668,884)]),ellipse((648,877,680,903)))
    scissors = sub(scissors,union(ellipse((602,815,649,872)),ellipse((663,795,712,848))))
    add("Tool_Scissors", 1330, mask=scissors, donor=(658,886,667,895), notes="Rigid gold scissors with source openings cut out; gold-mask edge refinement and hidden blades remain review tasks.")
    add("Pouch_Front", 1340, [(608,910),(635,914),(669,924),(704,931),(742,936),(778,937),(798,932),(803,951),(806,987),(802,1024),(794,1051),(780,1068),(754,1081),(721,1086),(687,1082),(653,1074),(630,1062),(620,1044),(614,1017),(608,985),(606,949)], donor=(710,979,745,1011))


def tiled_patch(rgb, mask, donor):
    result = rgb.copy()
    if not donor or not mask.getbbox(): return result
    sample = rgb.crop(donor); tile = Image.new("RGB", (W, H))
    x0,y0,x1,y1=mask.getbbox()
    for y in range(y0,y1,sample.height):
        for x in range(x0,x1,sample.width): tile.paste(sample,(x,y))
    result.paste(tile,(0,0),mask)
    return result


def clear_transparent_rgb(im):
    """Keep RGBA at all nonzero-alpha pixels; drop invisible RGB payload only."""
    result=Image.new("RGBA",im.size);result.paste(im,(0,0),binmask(im.getchannel("A")));return result


def blend_hidden_to_original(generated, original, target, original_visible, box):
    """Poisson color transition entirely inside declared hidden pixels.

    Dirichlet boundary uses original visible bodice only. Other boundaries use
    the donor, so occluding cape/scissors colors cannot leak into underpainting.
    """
    x0,y0,x1,y1=box;g=np.asarray(generated.crop(box)).astype(float);s=np.asarray(original.crop(box)).astype(float)
    mask=np.asarray(target.crop(box))>0;vis=np.asarray(original_visible.crop(box))>0
    ys,xs=np.where(mask);n=len(xs)
    if not n:return generated
    ids=np.full(mask.shape,-1,dtype=np.int32);ids[ys,xs]=np.arange(n)
    rows=[np.arange(n)];cols=[np.arange(n)];vals=[np.full(n,4.)];rhs=np.zeros((n,3));h,w=mask.shape
    for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
        qx=np.clip(xs+dx,0,w-1);qy=np.clip(ys+dy,0,h-1);neighbor=ids[qy,qx];inside=neighbor>=0
        rhs+=g[ys,xs]-g[qy,qx]
        rows.append(np.arange(n)[inside]);cols.append(neighbor[inside]);vals.append(np.full(int(inside.sum()),-1.))
        outside=~inside;boundary=np.where(vis[qy,qx,None],s[qy,qx],g[qy,qx]);rhs[outside]+=boundary[outside]
    system=coo_matrix((np.concatenate(vals),(np.concatenate(rows),np.concatenate(cols))),shape=(n,n)).tocsc()
    solved=np.clip(spsolve(system,rhs),0,255);tile=g.copy();tile[ys,xs]=solved
    result=generated.copy();result.paste(Image.fromarray(np.rint(tile).astype(np.uint8)),(x0,y0));return result


def refine_candidates(rgb):
    byid={p["id"]:p for p in PARTS}
    byid["Chest_Button"]["order"]=1345
    byid["Chest_Button"]["group"]="Body_Garment_Front"
    byid["Body_Base"]["group"]="Body_Support"
    byid["Body_Base"]["donor"]=(492,454,539,488)
    byid["Hat_BackInner"]["group"]="Hat_Inner"
    byid["Cape_L"]["candidate"]=poly([(594,724),(629,709),(666,711),(697,733),(724,762),(750,790),(785,815),(818,838),(837,855),(835,871),(817,880),(792,883),(765,877),(735,868),(706,853),(678,839),(653,822),(629,801),(613,779),(603,754)])
    byid["Cape_L"]["candidate"]=union(byid["Cape_L"]["candidate"],poly([(589,718),(622,718),(664,832),(628,832),(609,792),(595,758)]))
    byid["Cape_Back"]["candidate"]=poly([(461,735),(591,733),(599,749),(583,767),(545,779),(507,774),(479,761)])
    byid["Cape_Back"]["order"]=619
    # Actual visible sleeve/waist boundary traced at 20px source-grid spacing.
    byid["Arm_R_Upper"]["candidate"]=poly([(279,800),(345,821),(365,859),(351,897),(335,921),(317,943),(298,965),(278,985),(263,993),(219,975),(196,930),(196,889),(225,838)])
    byid["Arm_R_Lower"]["candidate"]=poly([(194,933),(218,945),(243,955),(258,971),(269,988),(273,1003),(261,1019),(246,1028),(225,1010),(204,999),(181,989),(166,977),(162,959),(175,943)])
    byid["Pouch_Strap"]["candidate"]=poly([(419,718),(440,747),(467,779),(495,812),(524,846),(550,875),(573,904),(590,934),(604,952),(619,950),(627,938),(620,917),(600,887),(573,855),(545,823),(518,792),(490,758),(463,731),(442,718)])
    for side in ("R","L"):
        byid[f"Boot_{side}"]["candidate"]=sub(byid[f"Boot_{side}"]["candidate"],byid[f"Sock_{side}"]["candidate"])
    # Cape overlaps the shoulder, sleeve overlaps the small green waist lobes.
    cape=union(byid["Cape_R"]["candidate"],byid["Cape_L"]["candidate"])
    for i,name in enumerate(["Arm_R_Upper","Arm_R_Lower","Hand_R","Arm_L_Upper","Arm_L_Lower","Hand_L"]):
        byid[name]["order"]=700+i
        byid[name]["candidate"]=sub(byid[name]["candidate"],cape)
    # Gold loop selection follows color/connected source pixels, preserving holes.
    pixels=np.asarray(rgb).astype(np.int16);r,g,b=pixels[:,:,0],pixels[:,:,1],pixels[:,:,2]
    strap_material=(r-g>17)&(g-b>12)&(b<150)
    strap_extra=inter(Image.fromarray((strap_material*255).astype(np.uint8)),byid["Pouch_Strap"]["candidate"].filter(ImageFilter.MaxFilter(25)))
    byid["Pouch_Strap"]["candidate"]=union(byid["Pouch_Strap"]["candidate"],strap_extra.filter(ImageFilter.MaxFilter(3)))
    roi=np.zeros((H,W),bool);roi[782:911,587:727]=True
    gold=roi&(r>120)&((r-g)>12)&((g-b)>29)
    gold=binary_closing(gold,structure=np.ones((3,3),bool))
    labels,count=label(gold);sizes=np.bincount(labels.ravel());largest=int(np.argmax(sizes[1:])+1)
    gold=labels==largest
    byid["Tool_Scissors"]["candidate"]=Image.fromarray((gold*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    # Re-trace the inner skirt edges; preserve the green piping in its petal.
    byid["Skirt_Petal_Front_L"]["candidate"]=poly([(493,1015),(581,1007),(616,1031),(649,1077),(682,1128),(707,1170),(706,1196),(690,1215),(661,1227),(629,1228),(611,1220),(579,1210),(564,1200),(548,1180),(532,1160),(522,1140),(514,1120),(508,1100),(503,1080),(500,1060),(496,1044)])
    byid["Skirt_Petal_Front_R"]["candidate"]=poly([(364,1004),(451,1011),(454,1045),(450,1060),(447,1080),(443,1100),(436,1120),(427,1140),(417,1160),(404,1180),(383,1200),(367,1210),(343,1220),(310,1223),(282,1213),(264,1196),(263,1174),(283,1134),(309,1084),(336,1037)])
    # Independent continuous tube silhouettes continue below the pocket lip.
    byid["Tool_Roll_A"]["complete"]=poly([(730,738),(736,727),(752,724),(770,727),(781,736),(780,750),(745,866),(720,963),(682,953),(704,854)])
    byid["Tool_Roll_B"]["complete"]=poly([(773,749),(781,739),(798,739),(815,744),(825,753),(821,769),(790,861),(762,971),(725,961),(749,853)])
    byid["Tool_Roll_C"]["complete"]=poly([(749,838),(760,826),(775,826),(793,832),(804,842),(806,852),(783,915),(763,977),(721,961),(738,892)])
    # Preserve already reviewed actual hair/braid ownership at shoulder overlap.
    # A high sleeve order must never steal the braid or its short green tie.
    head_source=binmask(Image.open(FACE/"masks/head-diagnostic-source-visible.png").convert("L"))
    # The original temporary head was in front of face/scarf. Its visible fringe
    # and jaw-adjacent locks must become real front-hair ownership, not residual
    # Hair_BackMass pixels hidden under r9's clean-face support.
    zones={
        "Hair_Bangs_Center":poly([(398,310),(609,310),(609,445),(398,455)]),
        "Hair_Bangs_R":poly([(320,335),(432,335),(432,452),(320,457)]),
        "Hair_Bangs_L":poly([(600,330),(729,330),(729,452),(600,452)]),
        "Hair_Side_R":poly([(303,445),(385,445),(385,694),(303,694)]),
        "Hair_Side_L":poly([(651,445),(735,445),(765,581),(895,581),(895,755),(651,755)]),
    }
    for name,zone in zones.items():byid[name]["candidate"]=union(byid[name]["candidate"],inter(zone,head_source))
    for i,name in enumerate(["Braid_Root","Braid_Mid","Braid_Tip","Hair_BraidTie"]):
        byid[name]["order"]=1040+i;byid[name]["group"]="Hair_Braid"
    byid["Braid_Root"]["candidate"]=union(byid["Braid_Root"]["candidate"],inter(head_source,poly([(320,686),(371,686),(371,747),(320,747)])))
    for p in PARTS:
        if p["id"].startswith(("Arm_","Hand_")):
            p["candidate"]=sub(p["candidate"],head_source)
    # Source gray sleeve pixels along the narrow waist junction belong to sleeve.
    gray=(np.asarray(rgb)[:,:,0].astype(int)-np.asarray(rgb)[:,:,1].astype(int)<18)&(np.asarray(rgb)[:,:,1].astype(int)-np.asarray(rgb)[:,:,2].astype(int)<32)&(np.asarray(rgb)[:,:,1]>100)
    joint=poly([(272,889),(361,889),(349,928),(324,958),(295,989),(274,1007),(262,994)])
    extra=inter(Image.fromarray((gray*255).astype(np.uint8)),joint,byid["Arm_R_Upper"]["candidate"].filter(ImageFilter.MaxFilter(21)))
    byid["Arm_R_Upper"]["candidate"]=union(byid["Arm_R_Upper"]["candidate"],extra)


def rgba_on(image, color=(60,66,59)):
    bg=Image.new("RGBA",image.size,(*color,255));bg.alpha_composite(image);return bg.convert("RGB")


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--revision",default="b1");parser.add_argument("--overwrite",action="store_true");args=parser.parse_args()
    out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions"/args.revision
    if (out/"body.metadata.json").exists() and not args.overwrite:raise SystemExit("Revision exists; choose a new revision")
    assert sha(SOURCE)==SHA,"Locked source changed"
    assert sha(FACE/"head-stage.metadata.json")=="f324576a6a127b91f4ce5ffbdf8881e62159b567d07d8247ff111fa7e04f66b6","Frozen r9 changed"
    for d in ("layers","source-visible","masks","patches","qa"): (out/d).mkdir(parents=True,exist_ok=True)
    source=Image.open(SOURCE).convert("RGBA");rgb=source.convert("RGB");a=source.getchannel("A");foreground=binmask(a)
    spec=json.loads(SPEC.read_text(encoding="utf-8"));specids={p["id"]:p for p in spec["layers"] if p["phase"]=="P0"}
    facevisible=Image.open(FACE/"masks/face-source-visible.png").convert("L")
    scarfvisible=Image.open(FACE/"masks/scarf-source-visible.png").convert("L")
    old_face_outline=poly(json.loads((FACE/"masks/ownership-points.json").read_text(encoding="utf-8"))["face"])
    source_head=binmask(Image.open(FACE/"masks/head-diagnostic-source-visible.png").convert("L"))
    face_reclaim=union(inter(old_face_outline.filter(ImageFilter.MaxFilter(13)),source_head,poly([(380,550),(651,550),(651,635),(380,635)])),inter(old_face_outline,source_head,poly([(449,449),(490,449),(490,465),(449,465)])))
    face_reclaim.save(out/"masks/Face_Base-original-cloth-reassigned-from-temporary-head.png")
    reserved=binmask(union(facevisible,scarfvisible,face_reclaim));available=sub(foreground,reserved)
    define_parts();refine_candidates(rgb); assert len(PARTS)==52 and len({p["id"] for p in PARTS})==52
    assert set(p["id"] for p in PARTS)=={n for n,s in specids.items() if s["group"] not in ("Face","Scarf")}
    ownership={};taken=blank()
    for part in sorted(PARTS,key=lambda p:p["order"],reverse=True):
        own=sub(inter(part["candidate"],available),taken);ownership[part["id"]]=own;taken=union(taken,own)
    initial_unassigned=sub(available,taken)
    # Original silhouette pixels outside the hand tracing are assigned to the
    # nearest already-owned boundary within 24 px. Distant alpha=1 source haze
    # is retained and separately logged; no new visible pixels are invented.
    labels=np.zeros((H,W),np.uint8)
    for idx,part in enumerate(PARTS):labels[np.asarray(ownership[part["id"]])>0]=idx+1
    distances,nearest=distance_transform_edt(labels==0,return_indices=True)
    missing=np.asarray(initial_unassigned)>0;alpha_array=np.asarray(a)
    recover=missing&((distances<=24)|(alpha_array<=1))
    recovered_labels=labels[nearest[0],nearest[1]]
    refinement=[]
    for idx,part in enumerate(PARTS):
        extra=recover&(recovered_labels==idx+1)
        if np.any(extra):
            mask=Image.fromarray((extra*255).astype(np.uint8));mask.save(out/f"masks/{part['id']}-source-boundary-recovery.png")
            ownership[part["id"]]=union(ownership[part["id"]],mask)
            refinement.append({"id":part["id"],"recoveredSourcePixels":int(extra.sum()),"recoveredSolidPixels":int((extra&(alpha_array>=250)).sum()),"maxSolidRecoveryDistance":float(distances[extra&(alpha_array>=250)].max()) if (extra&(alpha_array>=250)).any() else 0})
    taken=union(*ownership.values());unassigned=sub(available,taken);unassigned.save(out/"qa/unassigned-source-mask.png")
    (out/"qa/source-boundary-recovery.json").write_text(json.dumps({"method":"nearest existing semantic boundary; maximum 24px except alpha<=1 source haze","initialMissingPixels":int(missing.sum()),"retainedDistantAlphaOnePixels":int((recover&(distances>24)).sum()),"parts":refinement},indent=2),encoding="utf-8")
    # Never hide missed pixels in a production layer. An explicit QA residual is
    # excluded from the 72-layer manifest and blocks completeness.
    residual=source.copy();residual.putalpha(inter(unassigned,a));clear_transparent_rgb(residual).save(out/"qa/unassigned-source-pixels.png")
    normalization=a.point(lambda p:255 if p>=250 else 0);normalized=ImageChops.lighter(a,normalization)
    normalization.save(out/"masks/alpha-normalization-solid-only.png")
    items=[];layers={};source_rebuilt=Image.new("RGBA",(W,H));ownership_ids=np.zeros((H,W),dtype=np.uint8)
    for idx,part in enumerate(sorted(PARTS,key=lambda p:p["order"])):
        name=part["id"];own=ownership[name];higher=union(*(ownership[p["id"]] for p in PARTS if p["order"]>part["order"]))
        # Modest overlap under actual opaque occluders, not a duplicate whole image.
        proposed=part["complete"] if part["hidden"] else own.filter(ImageFilter.MaxFilter(17))
        actual_occluders=union(higher,reserved) if part["order"]<1000 else higher
        hidden=inter(sub(proposed,own),actual_occluders,normalization)
        required=inter(sub(part["complete"],union(own,hidden)),actual_occluders,normalization)
        imagegen_note=None
        if name=="Bodice_Olive":
            donor_path=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/candidates/bodice-hidden-r1/Bodice_Olive-hidden-paint-donor.png"
            assert donor_path.exists(),"Declared local bodice donor is missing"
            # Only registered hidden pixels are used; visible original RGB remains
            # exact. Generation is a local underpainting candidate, not a new doll.
            hidden=union(hidden,required);required=blank()
            donor=Image.open(donor_path).convert("RGB").resize((358,225),Image.Resampling.LANCZOS)
            registered=rgb.copy();registered.paste(donor,(322,725))
            sr=np.asarray(rgb).astype(np.int16);dr=np.asarray(registered).astype(np.int16)
            bare=(np.asarray(own)>0)&(sr[:,:,0]<200)&(sr[:,:,1]>100)&((sr[:,:,1]-sr[:,:,2])>25)&((sr[:,:,0]-sr[:,:,1])<30)
            correction=np.median((sr-dr)[bare],axis=0);corrected=np.clip(dr+correction,0,255).astype(np.uint8)
            generated=Image.fromarray(corrected);generated=blend_hidden_to_original(generated,rgb,hidden,Image.fromarray((bare*255).astype(np.uint8)),(322,725,680,950));colors=rgb.copy();colors.paste(generated,(0,0),hidden)
            imagegen_note={"donor":str(donor_path),"donorSha256":sha(donor_path),"registeredRoi":[322,725,680,950],"registration":"Resize donor to exact358x225 ROI; paste at322,725; no source-visible replacement","rgbMedianCorrection":correction.tolist(),"seamMethod":"Poisson gradient blend within hidden mask only; original visible bodice supplies Dirichlet boundary; occluder colors excluded","colorCalibrationOriginalBareGreenPixelCount":int(bare.sum()),"status":"local_hidden_paint_candidate_pending_seam_and_pose_review"}
        else:colors=tiled_patch(rgb,hidden,part["donor"])
        hidden.save(out/f"patches/{name}-local-hidden-mask.png")
        required.save(out/f"patches/{name}-uncompleted-occlusion-mask.png")
        pixels=colors.convert("RGBA")
        pixels.putalpha(union(inter(own,normalized),hidden));pixels=clear_transparent_rgb(pixels)
        count=int(np.count_nonzero(np.asarray(pixels.getchannel("A"))))
        visible_count=int(np.count_nonzero(np.asarray(own)))
        if not count:raise ValueError(f"Empty production candidate {name}; no placeholder allowed")
        original=source.copy();original.putalpha(inter(own,a));original=clear_transparent_rgb(original);original.save(out/f"source-visible/{name}.png")
        source_rebuilt.alpha_composite(original)
        pixels.save(out/f"layers/{name}.png");own.save(out/f"masks/{name}-source-ownership.png")
        ownership_ids[np.asarray(own)>0]=idx+1;layers[name]=pixels
        status="visible_source_separated_local_overlap_pending_review" if visible_count else "fully_occluded_local_reconstruction_pending_review"
        item={"id":name,"group":part["group"] or specids[name]["group"],"order":part["order"],"path":f"layers/{name}.png","visible":True,"opacity":1,"temporary":False,"status":status,"sourceVisible":f"source-visible/{name}.png","sourceMask":f"masks/{name}-source-ownership.png","patchMasks":[f"patches/{name}-local-hidden-mask.png"],"uncompletedOcclusionMask":f"patches/{name}-uncompleted-occlusion-mask.png","uncompletedOcclusionPixels":int(np.count_nonzero(np.asarray(required))),"sourcePixelCount":visible_count,"patchPixelCount":int(np.count_nonzero(np.asarray(hidden))),"rgbaNonemptyPixels":count,"donorBox":part["donor"],"sha256":sha(out/f"layers/{name}.png"),"notes":part["notes"],"poseAccepted":False}
        if part["group"]:item["groupOverrideReason"]={"Body_Garment_Front":"Source chest button lies above diagonal pouch strap.","Body_Support":"Cloth body support remains behind separate legs and garments.","Hat_Inner":"Visible lining is behind hair; crown and front brim are above hair.","Hair_Braid":"Source braid is in front of scarf/cape and behind side locks; preserve this actual overlap rather than the generic plan group."}[part["group"]]
        if imagegen_note:
            visible_rgb_diff=np.any(np.asarray(pixels)[:,:,:3]!=np.asarray(source)[:,:,:3],axis=2)&(np.asarray(own)>0)
            assert not visible_rgb_diff.any(),"Generated pixels touched visible original bodice"
            imagegen_note["sourceVisibleRgbChangedPixels"]=int(visible_rgb_diff.sum());item["localGeneratedUnderpainting"]=imagegen_note
            (out/"qa/Bodice_Olive-hidden-paint-audit.json").write_text(json.dumps(imagegen_note,indent=2),encoding="utf-8")
        items.append(item)
    source_reserved=source.copy();source_reserved.putalpha(inter(reserved,a));source_rebuilt.alpha_composite(source_reserved)
    source_rebuilt.save(out/"qa/source-ownership-neutral.png")
    s=np.asarray(source);r=np.asarray(source_rebuilt);active=s[:,:,3]>0
    mismatch=np.any(s!=r,axis=2)&active
    comparison={"type":"SOURCE_OWNERSHIP_AUDIT_NOT_MODEL_VALIDATION","sourceSha256":SHA,"sourceUnmodified":sha(SOURCE)==SHA,"r9Unmodified":sha(FACE/"head-stage.metadata.json")=="f324576a6a127b91f4ce5ffbdf8881e62159b567d07d8247ff111fa7e04f66b6","nonFaceScarfLayerCount":len(items),"unassignedSourcePixels":int(np.count_nonzero(np.asarray(unassigned))),"unassignedSolidSourcePixels":int(np.count_nonzero((np.asarray(unassigned)>0)&(np.asarray(a)>=250))),"rgbaMismatchSourceActivePixels":int(np.count_nonzero(mismatch)),"sourceVisibleRgbChanged":sum(int(np.count_nonzero(np.any(np.asarray(Image.open(out/p['sourceVisible']))[:,:,:3]!=s[:,:,:3],axis=2)&(np.asarray(Image.open(out/p['sourceVisible']))[:,:,3]>0))) for p in items),"neutralCompletenessPass":not bool(np.any(mismatch)),"productionAccepted":False,"modelAccepted":False}
    (out/"qa/source-ownership-audit.json").write_text(json.dumps(comparison,indent=2),encoding="utf-8")
    data={"schemaVersion":1,"characterId":"forest-spirit-front-v8","stage":"production-p0","status":"WIP_VISIBLE_SEPARATION_AND_LOCAL_PATCHES_NOT_ACCEPTED","canvas":{"width":W,"height":H},"source":str(SOURCE),"sourceSha256":SHA,"sourceSpec":str(SPEC),"sourceSpecSha256":sha(SPEC),"frozenFaceRevision":"r9_read_only_not_copied_or_changed","layers":items,"limitations":["52 source-visible separations and local hidden-texture candidates; isolated contours and every moving overlap still require visual review.","Fully occluded supports use declared original texture donors; they are not source-visible extracted artwork.","A neutral ownership match cannot validate hidden repairs or animation.","No rigid whole-braid rotation is used as model evidence.","No PSD or Cubism model is generated by this script."]}
    (out/"body.metadata.json").write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    # A 72-part raster diagnostic references the frozen r9 pixels directly; it
    # does not silently promote separation or replace source files used by Editor.
    combined=json.loads(json.dumps(data));combined["status"]="WIP_72_PART_RASTER_DIAGNOSTIC_DO_NOT_TREAT_AS_ACCEPTED_PRODUCTION"
    face_data=json.loads((FACE/"head-stage.metadata.json").read_text(encoding="utf-8"))
    counters={"Face_Support":800,"Scarf":900,"Face":1000}
    for source_part in sorted(face_data["layers"],key=lambda p:p["order"]):
        if source_part.get("temporary"):continue
        p=dict(source_part);p["path"]=str((FACE/p["path"]).resolve());p["order"]=counters[p["group"]];counters[p["group"]]+=1
        for field in ("sourceVisible","mask"):
            if p.get(field):p[field]=str((FACE/p[field]).resolve())
        p["patchMasks"]=[str((FACE/q).resolve()) for q in p.get("patchMasks",[])]
        p["frozenSourceRevision"]="r9";p["status"]="frozen_r9_face_or_scarf_read_only_dynamic_not_accepted";combined["layers"].append(p)
        if p["id"]=="Face_Base":
            previous=Image.open(p["path"]).convert("RGBA");fixed=previous.copy();cloth=source.copy();cloth.putalpha(normalized);fixed.paste(cloth,(0,0),face_reclaim)
            fixed.save(out/"layers/Face_Base.png");fixed.getchannel("A").save(out/"masks/Face_Base.png")
            assert np.array_equal(np.asarray(previous)[np.asarray(face_reclaim)==0],np.asarray(fixed)[np.asarray(face_reclaim)==0])
            p["path"]="layers/Face_Base.png";p["mask"]="masks/Face_Base.png";p["sha256"]=sha(out/p["path"]);p["frozenSourceRevision"]="r9_pixels_plus_declared_original_face_cloth_boundary_reassignment"
            p["sourceReassignmentMask"]="masks/Face_Base-original-cloth-reassigned-from-temporary-head.png";p["status"]="original_face_cloth_boundary_candidate_r9_file_unchanged"
            face_original=Image.open(source_part["sourceVisible"] if Path(source_part["sourceVisible"]).is_absolute() else FACE/source_part["sourceVisible"]).convert("RGBA");face_original.paste(source,(0,0),face_reclaim);face_original.save(out/"source-visible/Face_Base.png");p["sourceVisible"]="source-visible/Face_Base.png"
            (out/"qa/Face_Base-boundary-reassignment-audit.json").write_text(json.dumps({"originalR9FileChanged":False,"sourceReassignedPixels":int(np.count_nonzero(np.asarray(face_reclaim))),"outsideDeclaredMaskRgbaChanges":0,"source":"Locked v8 original cloth pixels; no generated face pixels","reason":"Temporary head composite previously owned visible original cheek cloth; return it to the face base when replacing the temporary composite with real hair layers."},indent=2),encoding="utf-8")
    combined["layers"].sort(key=lambda p:p["order"]);assert len(combined["layers"])==72
    combined["productionLayerCount"]=72;combined["temporaryLayerCount"]=0;combined["productionAccepted"]=False;combined["modelAccepted"]=False
    (out/"fullbody-with-r9.metadata.json").write_text(json.dumps(combined,ensure_ascii=False,indent=2),encoding="utf-8")
    neutral=Image.new("RGBA",(W,H))
    for p in combined["layers"]:
        if p.get("visible",True):neutral.alpha_composite(Image.open(Path(p["path"]) if Path(p["path"]).is_absolute() else out/p["path"]).convert("RGBA"))
    neutral.save(out/"qa/72-part-neutral-candidate.png")
    nr=np.asarray(neutral);sr=np.asarray(source);solid=sr[:,:,3]>=250
    delta=np.max(np.abs(nr[:,:,:3].astype(int)-sr[:,:,:3].astype(int)),axis=2)
    visible_diff=solid&(delta>3);Image.fromarray((visible_diff*255).astype(np.uint8)).save(out/"qa/72-part-neutral-rgb-difference-over3-mask.png")
    (out/"qa/72-part-neutral-candidate-audit.json").write_text(json.dumps({"type":"72_PART_RASTER_DIAGNOSTIC_NOT_CUBISM","sourceSolidPixelsWithRgbDeltaOver3":int(visible_diff.sum()),"maxSolidRgbChannelDifference":int(delta[solid].max()),"candidateSha256":sha(out/"qa/72-part-neutral-candidate.png"),"sourceOwnershipReconstructionIsSeparateProof":True,"productionAccepted":False,"poseAccepted":False,"modelAccepted":False},indent=2),encoding="utf-8")
    (out/"ownership-geometry.json").write_text(json.dumps({"sourceSha256":SHA,"coordinateConvention":"Anatomical L is viewer right. Full 971x1620 canvas.","parts":[{"id":p["id"],"order":p["order"],"mask":f"masks/{p['id']}-source-ownership.png","patch":f"patches/{p['id']}-local-hidden-mask.png","donorBox":p["donor"]} for p in PARTS]},indent=2),encoding="utf-8")
    palette=np.array([[round(100+100*math.sin(i*2.3)),round(100+100*math.sin(i*3.1+2)),round(100+100*math.sin(i*1.7+4))] for i in range(53)],dtype=np.uint8);palette[0]=[40,40,40]
    Image.fromarray(palette[ownership_ids]).save(out/"qa/ownership-map.png")
    source_detail=rgba_on(source);annotated=source_detail.copy();draw=ImageDraw.Draw(annotated)
    for p in items:
        box=ownership[p["id"]].getbbox()
        if box:draw.text((box[0],box[1]),p["id"],fill=(255,50,120),stroke_width=1,stroke_fill=(20,20,20))
    annotated.save(out/"qa/ownership-labels.png")
    for group in sorted({p["group"] for p in items}):
        members=[p for p in items if p["group"]==group];cols=3;tw,th=330,390;sheet=Image.new("RGB",(cols*tw,math.ceil(len(members)/cols)*th),(46,52,46));d=ImageDraw.Draw(sheet)
        for i,p in enumerate(members):
            im=layers[p["id"]];box=im.getbbox();tile=rgba_on(im.crop(box));tile.thumbnail((tw-10,th-45));x=(i%cols)*tw;y=(i//cols)*th;sheet.paste(tile,(x+(tw-tile.width)//2,y+30));d.text((x+6,y+5),p["id"],fill="white");d.text((x+6,y+th-16),f"source {p['sourcePixelCount']} / patch {p['patchPixelCount']}",fill=(210,215,210))
        sheet.save(out/f"qa/{group}-isolated-contact.png")
        source_sheet=Image.new("RGB",sheet.size,(46,52,46));sd=ImageDraw.Draw(source_sheet)
        for i,p in enumerate(members):
            im=Image.open(out/p["sourceVisible"]).convert("RGBA");box=im.getbbox();x=(i%cols)*tw;y=(i//cols)*th
            if box:
                tile=rgba_on(im.crop(box));tile.thumbnail((tw-10,th-45));source_sheet.paste(tile,(x+(tw-tile.width)//2,y+30))
            sd.text((x+6,y+5),p["id"],fill="white");sd.text((x+6,y+th-16),"SOURCE VISIBLE ONLY" if box else "FULLY OCCLUDED / NO SOURCE PIXELS",fill=(210,215,210))
        source_sheet.save(out/f"qa/{group}-source-contact.png")
    text=[f"# Frontal v8 full-body separation {args.revision}", "", "Status: work in progress; no production/model/pose acceptance.", "", f"Source SHA256: `{SHA}`.", "", "| Part | Source pixels | Local hidden patch pixels | Actual status |", "|---|---:|---:|---|"]
    text += [f"| {p['id']} | {p['sourcePixelCount']} | {p['patchPixelCount']} | {p['status']} |" for p in items]
    text += ["", "## Head/scarf overlap plan", "", "- Keep r9 face and scarf PNGs frozen. Their existing ±5 raster test is not accepted as a dynamic result.", "- Hair_BackMass and face follow a shared head deformer; Hair_Side_R attaches at its upper root. Braid_Root, Braid_Mid and Braid_Tip form nested deformers with decreasing head influence. The tip is not a rigid part of head rotation.", "- Scarf_Upper follows jaw/neck through restrained mesh deformation; Scarf_Middle and Lower progressively follow the body. Scarf_Back remains underneath as continuous brown coverage. Do not rotate the whole scarf wedge into the cape.", "- Actual source junctions requiring clean overlap review: viewer-left jaw/scarf at x345..390,y590..682; viewer-right jaw/scarf at x651..705,y590..714; braid/cape x240..365,y700..875; loose right hair/cape x659..735,y650..757.", "- Minimum hidden extension must be measured from actual posed mesh sweep, plus a filter margin, while preserving the neutral silhouette. Raster ownership partition alone is not animation-ready.", "- Next review each isolated contact, correct contour ownership before any full-body PSD reimport, then inspect actual Editor poses with every occluder visible and hidden."]
    (out/"status.md").write_text("\n".join(text)+"\n",encoding="utf-8")
    print(json.dumps(comparison,indent=2))


if __name__=="__main__":main()
