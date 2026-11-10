"""Original-pixel separation of the approved v2 body, with audited hidden patches.

This is a reproducible historical separation candidate, not rig-ready art.
FROZEN: the user subsequently required a fully front-facing face AND body.
This three-quarter v2 source is superseded and must not become the production rig.
The user explicitly authorized programmatic masks and local texture reconstruction.
Face pixels are owned by separate-face.py; this script never modifies the source.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "output/forest-spirit-production-v2/body"
sys.path.insert(0, str(OUT / "_deps"))
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SOURCE = ROOT / "doc/design/forest-spirit/production/master/forest-spirit-approved-v2.png"
SPEC = ROOT / "doc/design/forest-spirit/production/layers-v2.json"
FACE = ROOT / "output/forest-spirit-production-v2/face/masks/face-ownership.png"
W, H = 982, 1602


def poly(points):
    result = Image.new("L", (W, H))
    ImageDraw.Draw(result).polygon(points, fill=255)
    return np.asarray(result).astype(bool)


def ellipse(box):
    result = Image.new("L", (W, H))
    ImageDraw.Draw(result).ellipse(box, fill=255)
    return np.asarray(result).astype(bool)


def line(points, width):
    result = Image.new("L", (W, H))
    ImageDraw.Draw(result).line(points, fill=255, width=width, joint="curve")
    return np.asarray(result).astype(bool)


EMPTY = np.zeros((H, W), dtype=bool)
PARTS = []


def add(name, order, points=None, *, mask=None, complete=None, donor=None, notes="", hidden=False):
    outline = mask if mask is not None else poly(points)
    PARTS.append(dict(id=name, order=order, candidate=EMPTY.copy() if hidden else outline,
                      complete=complete if complete is not None else outline,
                      donor=donor, notes=notes, hidden=hidden))


def define_parts():
    # Anatomical R is the viewer's left. These are contour masks, not rectangular crops.
    add("Hair_BackMass", 100, [(286,435),(351,329),(480,275),(671,279),(766,329),(821,444),(852,504),(842,566),(817,606),(775,629),(709,646),(644,625),(558,644),(486,682),(395,714),(309,695),(270,666),(250,614),(260,549)], donor=(293,584,337,647))
    add("Braid_Root", 101, [(344,630),(421,628),(477,655),(454,700),(407,732),(330,758),(255,772),(239,751),(245,718),(283,697),(319,682)], donor=(303,719,340,744))
    add("Braid_Mid", 102, [(345,710),(412,693),(416,740),(387,775),(328,817),(271,837),(241,818),(268,782),(293,751)], donor=(299,774,324,796))
    add("Braid_Tip", 103, [(231,833),(284,842),(289,869),(268,900),(266,940),(248,965),(242,992),(210,993),(183,975),(163,945),(170,899),(196,861)], donor=(198,901,228,938))
    add("Hair_FlowerTie", 104, [(384,603),(410,598),(432,601),(447,612),(462,623),(469,645),(460,660),(443,671),(455,689),(449,710),(430,727),(405,725),(386,711),(355,702),(350,687),(372,674),(382,658),(377,639),(381,627)], donor=(390,625,406,641), notes="Flower, leaves and tiny red tie remain one approved accessory cluster.")

    add("Sock_L", 200, [(542,1203),(662,1202),(665,1268),(651,1285),(676,1301),(674,1351),(659,1375),(540,1370),(523,1342),(522,1304),(532,1285),(536,1245)], donor=(571,1248,621,1280))
    add("Sock_R", 201, [(395,1203),(531,1202),(518,1254),(505,1295),(528,1310),(519,1360),(503,1378),(366,1357),(371,1300),(380,1270)], donor=(421,1244,466,1280))
    add("Boot_L", 202, [(535,1339),(656,1348),(683,1368),(684,1421),(701,1454),(720,1492),(724,1532),(711,1552),(661,1559),(578,1555),(525,1533),(510,1498),(515,1446)], donor=(604,1439,639,1481))
    add("Boot_R", 203, [(356,1314),(497,1348),(529,1395),(549,1436),(578,1490),(587,1540),(572,1561),(516,1565),(441,1558),(357,1552),(330,1542),(322,1508),(332,1443),(329,1398)], donor=(421,1450,469,1494))
    add("Boot_Cuff_L", 204, [(533,1346),(652,1355),(677,1360),(691,1376),(687,1415),(670,1435),(648,1427),(598,1417),(541,1418),(515,1397),(521,1365)], donor=(585,1378,616,1401))
    add("Boot_Cuff_R", 205, [(347,1313),(385,1319),(432,1335),(499,1358),(520,1378),(531,1415),(508,1433),(455,1444),(391,1440),(340,1428),(322,1411),(332,1374)], donor=(356,1351,384,1382))

    add("Body_Base", 300, [(474,678),(643,678),(704,750),(713,883),(678,972),(471,977),(410,888),(424,758)], hidden=True, donor=(358,977,387,1009), notes="Fully hidden body foundation: source linen texture reconstruction, no visible skin redesign. Not an anatomically validated arm-raising base.")
    add("Cape_Back", 301, [(352,733),(451,686),(626,688),(724,703),(782,755),(794,818),(751,863),(632,880),(484,887),(349,866),(321,843)], hidden=True, donor=(368,806,397,831), notes="Hidden short-cape support, reconstructed from original cream weave. No long pointed cape added.")
    add("Skirt_Base", 302, [(470,948),(653,945),(765,1009),(838,1093),(890,1172),(869,1228),(789,1244),(709,1256),(613,1255),(516,1257),(424,1246),(332,1234),(249,1216),(191,1184),(208,1118),(283,1054),(371,996)], donor=(572,1060,598,1090), notes="Cream under-skirt reconstructed only behind opaque visible panels; lace holes retain the approved master alpha.")
    add("Lace_Hem", 303, [(207,1142),(285,1152),(376,1175),(475,1186),(563,1191),(673,1185),(782,1156),(859,1146),(890,1182),(875,1218),(824,1241),(758,1250),(704,1253),(658,1257),(609,1259),(555,1255),(508,1258),(456,1250),(406,1247),(361,1236),(309,1234),(264,1217),(221,1204),(191,1183)], donor=(390,1197,422,1220))
    add("Skirt_RedPanel", 304, [(507,959),(562,957),(585,1055),(601,1130),(628,1192),(597,1207),(523,1208),(458,1198),(419,1177),(450,1106),(481,1020)], donor=(514,1087,547,1138))
    add("Skirt_Petal_R", 305, [(415,961),(519,989),(516,1033),(494,1098),(474,1156),(451,1186),(419,1201),(381,1202),(344,1184),(322,1156),(294,1168),(253,1172),(215,1164),(193,1148),(205,1117),(229,1079),(272,1037),(333,992)], donor=(405,1030,432,1060), notes="Approved master has four visible white lobes but the supplied plan has three IDs. The two adjacent viewer-left lobes are retained together here; no lobe removed or invented.")
    add("Skirt_Petal_L", 306, [(699,977),(745,1001),(785,1040),(829,1098),(871,1143),(893,1174),(879,1189),(853,1195),(821,1189),(784,1176),(754,1156),(737,1113),(711,1057)], donor=(775,1095,796,1120))
    add("Skirt_Petal_Center", 307, [(564,989),(627,990),(697,994),(714,1041),(740,1099),(765,1155),(753,1184),(730,1203),(694,1214),(657,1210),(620,1194),(591,1163),(575,1113),(563,1051)], donor=(638,1046,666,1075))
    add("Bodice_Olive", 308, [(499,709),(611,701),(684,721),(718,780),(745,878),(713,935),(675,955),(585,958),(498,940),(456,897),(464,823)], donor=(563,854,594,886))
    add("Peplum_R", 309, [(464,903),(556,916),(548,960),(528,1006),(501,1018),(458,1005),(417,999),(371,993),(321,1006),(293,1004),(316,973),(374,942),(421,924)], donor=(468,958,495,982))
    add("Peplum_L", 310, [(619,912),(694,915),(714,941),(734,976),(738,996),(710,1005),(679,1004),(651,1010),(622,986)], donor=(673,955,696,979))
    add("Peplum_Center", 311, [(554,916),(612,915),(627,943),(634,980),(641,1007),(627,1028),(608,1041),(580,1040),(554,1029),(535,1007),(540,971)], donor=(574,956,600,986))
    add("Cape_R", 312, [(453,715),(506,696),(549,703),(571,730),(587,772),(592,814),(577,839),(559,845),(546,843),(533,863),(509,870),(498,883),(474,892),(449,889),(429,879),(409,879),(387,875),(367,875),(344,862),(330,845),(353,817),(380,784),(414,746)], donor=(397,817,418,839))
    add("Cape_L", 313, [(671,701),(713,702),(744,722),(767,751),(786,790),(785,823),(768,839),(745,839),(718,826),(692,789)], donor=(728,738,746,758))
    add("Chest_Button", 314, mask=ellipse((651,765,708,830)), donor=(664,779,688,803))

    add("Arm_L_Upper", 400, [(724,777),(754,783),(777,816),(782,862),(767,896),(737,884),(715,834)], hidden=True, donor=(368,881,399,910), notes="Viewer-right upper arm is occluded in the source; local original sleeve weave clone. Requires pose review before hat-touch motion.")
    add("Arm_L_Lower", 401, [(738,849),(778,850),(790,906),(786,948),(756,968),(728,952),(728,902)], hidden=True, donor=(365,913,393,938), notes="Occluded forearm reconstruction; no claim of a visible original sleeve boundary.")
    add("Hand_L", 402, [(752,932),(781,938),(795,968),(787,999),(768,1011),(745,993),(738,965)], hidden=True, donor=(354,979,382,1009), notes="Hidden mitten-shaped cloth hand, using approved visible hand linen; no extra finger joints.")
    add("Arm_R_Upper", 403, [(358,857),(411,866),(469,867),(487,884),(477,919),(462,941),(420,957),(367,949),(340,928),(335,897)], donor=(369,886,394,913))
    add("Arm_R_Lower", 404, [(348,904),(386,919),(433,923),(466,935),(450,961),(431,979),(409,979),(389,963),(360,960),(341,947),(336,929)], donor=(358,923,386,940))
    add("Hand_R", 405, [(352,953),(376,957),(406,968),(409,989),(398,1017),(382,1038),(364,1043),(345,1034),(334,1016),(338,985)], donor=(355,981,382,1007))

    add("Scarf_Main", 600, [(490,619),(544,610),(586,614),(647,611),(696,614),(725,628),(737,651),(725,671),(747,681),(752,702),(736,718),(702,724),(657,719),(612,717),(570,709),(534,706),(500,718),(458,738),(429,732),(416,716),(430,686),(458,654)], donor=(579,678,615,698))
    add("Scarf_Tail_A", 601, [(51,812),(89,799),(160,788),(230,779),(279,768),(298,783),(275,809),(244,827),(212,850),(164,861),(116,876),(73,885),(69,870),(83,849),(66,836),(41,839)], donor=(133,811,168,835), notes="Long red tail is attached visually near the braid tie in this master; retained under the supplied Scarf_Tail ID. Rig attachment must follow actual tie, not inferred neck origin.")
    add("Scarf_Tail_B", 602, [(257,811),(282,836),(253,859),(226,881),(202,907),(176,938),(145,964),(117,980),(105,960),(98,938),(71,951),(75,931),(100,900),(133,870),(177,842),(215,823)], donor=(134,891,157,915))
    add("Scarf_Knot", 603, [(241,797),(254,797),(270,812),(280,824),(302,831),(317,850),(315,867),(302,881),(281,879),(264,863),(258,897),(242,906),(230,896),(234,877),(238,855),(220,855),(214,844),(219,824)], donor=(238,821,252,840), notes="Visible red braid bow is the source knot for the two long tails; preserved exactly, not moved to the neck.")

    add("Hair_Bangs_Center", 700, [(459,299),(541,279),(625,289),(656,304),(650,336),(630,372),(602,407),(574,431),(550,459),(515,480),(482,498),(436,520),(401,523),(371,510),(357,490),(378,468),(403,441),(428,412),(447,373)], donor=(480,381,511,421))
    add("Hair_Bangs_R", 701, [(325,431),(369,388),(420,357),(465,330),(465,370),(447,418),(422,462),(392,496),(366,511),(336,508),(308,536),(290,531),(304,482)], donor=(344,444,370,477))
    add("Hair_Side_R", 702, [(424,490),(452,484),(479,483),(486,517),(502,552),(523,582),(553,606),(549,622),(516,635),(485,626),(463,612),(443,585),(432,557),(426,527)], donor=(455,543,480,580))
    add("Hair_Bangs_L", 703, [(622,275),(657,274),(689,287),(715,310),(743,337),(768,358),(796,376),(824,380),(825,394),(803,400),(778,394),(753,382),(728,364),(708,347),(685,334),(657,326),(639,323)], donor=(701,325,723,348))
    add("Hair_Side_L", 704, [(756,366),(779,380),(806,397),(818,416),(839,435),(866,451),(889,457),(906,440),(911,462),(897,483),(874,496),(846,496),(847,531),(838,567),(821,595),(795,614),(759,631),(721,645),(698,635),(685,620),(710,608),(739,580),(756,550),(767,518),(767,471),(763,422)], donor=(785,505,808,540))

    add("Hat_BackInner", 800, [(238,501),(282,462),(367,394),(459,341),(558,304),(647,276),(715,269),(768,283),(817,306),(849,328),(861,360),(852,396),(836,425),(811,445),(792,416),(773,373),(733,329),(677,303),(609,314),(544,343),(474,383),(404,426),(348,478),(302,533),(273,581),(258,596),(240,575),(228,546)], donor=(820,341,839,370))
    add("Hat_Brim_Back", 801, [(235,425),(270,350),(325,292),(400,242),(494,229),(650,228),(756,245),(812,281),(847,313),(859,341),(845,342),(821,320),(779,297),(734,280),(671,268),(610,278),(534,304),(471,336),(416,376),(366,423),(315,474),(276,515),(244,512),(217,489),(212,460)], donor=(235,447,254,469))
    add("Hat_Dome", 802, [(274,254),(296,205),(340,164),(404,132),(473,108),(513,99),(565,109),(620,119),(666,134),(709,160),(740,190),(758,225),(768,248),(709,258),(654,260),(594,282),(533,311),(471,350),(402,393),(350,429),(306,444),(274,405),(253,354)], donor=(596,161,632,202))
    add("Hat_Brim_Front", 803, [(237,467),(277,426),(320,391),(353,352),(387,318),(429,288),(472,268),(515,249),(560,230),(605,216),(639,218),(676,224),(704,230),(730,224),(755,237),(780,250),(796,274),(822,288),(843,315),(848,334),(831,332),(811,315),(792,307),(778,293),(756,281),(736,281),(710,273),(693,260),(680,274),(660,283),(638,283),(614,275),(598,298),(576,314),(552,321),(527,319),(510,310),(508,333),(494,353),(472,367),(447,373),(420,371),(420,398),(407,421),(385,438),(363,447),(342,447),(329,440),(321,460),(300,483),(274,504),(252,513),(235,509),(223,498)], donor=(568,262,590,282))
    add("Hat_Leaves", 804, mask=poly([(90,461),(110,430),(115,400),(143,382),(131,367),(164,347),(198,338),(218,313),(244,291),(276,282),(266,255),(235,250),(211,245),(194,232),(178,219),(178,201),(193,184),(221,182),(233,164),(249,157),(272,169),(288,160),(309,176),(337,153),(351,131),(382,139),(400,112),(421,117),(431,88),(449,99),(459,72),(477,70),(490,81),(513,64),(533,69),(534,89),(514,111),(542,108),(561,115),(575,116),(604,127),(609,140),(574,144),(542,150),(518,157),(532,173),(544,187),(530,199),(504,201),(486,205),(454,214),(425,228),(395,263),(391,301),(380,328),(369,347),(353,360),(345,386),(329,395),(307,414),(288,420),(273,409),(258,397),(252,374),(237,390),(223,410),(207,428),(190,447),(172,467),(148,470),(128,484),(108,482)]), donor=(266,337,285,365))
    add("Hat_Ribbon", 805, mask=(poly([(278,245),(302,249),(307,263),(281,284),(263,299),(243,324),(222,350),(207,384),(197,417),(193,457),(187,497),(177,540),(162,559),(149,551),(153,517),(165,475),(168,433),(177,391),(191,350),(213,313),(239,282)]) | line([(283,256),(250,253),(213,264),(180,284),(163,307),(165,329),(185,337),(213,324),(243,305),(270,280)], 21)), donor=(174,411,184,444))
    add("Hat_Berries", 806, mask=ellipse((345,113,404,174)) | ellipse((397,129,451,187)), donor=(362,132,383,151))
    add("Hat_Flowers", 807, mask=poly([(349,184),(363,165),(381,155),(400,160),(415,171),(417,194),(428,195),(448,201),(463,214),(470,232),(460,246),(442,255),(425,258),(433,272),(432,291),(418,306),(400,309),(385,299),(375,312),(356,316),(342,306),(338,293),(321,295),(301,286),(287,271),(289,256),(303,244),(306,233),(298,219),(295,205),(307,189),(324,180),(337,183)]), donor=(384,191,397,215))
    add("Bell_Cord", 808, mask=line([(171,534),(167,545),(169,555),(165,569),(162,582),(151,583)], 10) | ellipse((150,539,185,579)), donor=(160,549,170,559))
    add("Bell_Body", 809, [(146,572),(169,576),(187,591),(190,610),(194,628),(199,637),(193,651),(172,657),(148,653),(133,648),(111,640),(106,632),(115,619),(122,595),(131,581)], donor=(140,594,160,612))

    add("Pouch_Strap", 900, [(540,694),(567,696),(589,718),(618,750),(648,785),(684,824),(717,861),(742,890),(726,922),(705,908),(688,879),(665,854),(634,821),(602,783),(577,752),(551,718)], donor=(610,763,622,780))
    add("Pouch_Back", 901, [(714,862),(751,854),(800,863),(850,883),(888,899),(904,927),(910,968),(902,1012),(883,1040),(844,1061),(792,1054),(752,1035),(716,1007),(693,963),(683,914),(688,884)], donor=(760,969,783,997))
    add("Tool_Scissors", 902, mask=(ellipse((702,789,757,867)) | ellipse((748,762,796,842)) | poly([(731,842),(745,841),(751,892),(740,916),(733,904)]) | poly([(768,828),(784,828),(771,903),(756,915),(757,890)])) & ~(ellipse((714,802,744,850)) | ellipse((759,774,784,826))), complete=poly([(703,786),(753,787),(765,758),(790,763),(801,806),(782,849),(773,931),(749,956),(727,922)]), donor=(766,838,772,862), notes="Scissor handle holes remain genuinely transparent. Hidden shafts are local gold texture continuations, not a new visible tool design.")
    add("Tool_PatternRoll", 903, [(808,703),(832,704),(851,714),(861,732),(850,773),(836,817),(824,857),(811,887),(786,878),(788,844),(795,803),(800,759)], donor=(813,747,831,778))
    add("Tool_FabricRoll", 904, mask=poly([(843,717),(865,718),(886,731),(882,755),(867,797),(854,833),(839,857),(821,850),(825,813),(831,774)]) | poly([(840,801),(859,804),(883,815),(893,832),(883,861),(868,901),(851,914),(827,904),(823,877),(829,835)]), donor=(847,842,867,865), notes="The two auxiliary cream rolls already visible in the approved master stay grouped; no additional large tool added.")
    add("Pouch_Front", 905, [(702,869),(730,870),(759,881),(790,886),(819,891),(850,893),(880,901),(900,917),(914,937),(918,952),(908,965),(910,992),(899,1020),(880,1043),(856,1057),(824,1064),(794,1059),(768,1047),(741,1035),(723,1005),(709,966),(698,928),(690,891)], donor=(817,958,839,982))


def bbox(mask):
    yy, xx = np.nonzero(mask)
    return [int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)] if len(xx) else None


def tiled_texture(source, rect):
    x0, y0, x1, y1 = rect
    yy, xx = np.indices((H, W))
    # Preserve fiber direction. Mirroring hair/embroidery produces invented diamond motifs.
    tw, th = x1-x0, y1-y0
    tx, ty = (xx-x0) % tw + x0, (yy-y0) % th + y0
    return source[ty, tx, :3]


def refine_material_boundaries(source):
    by_id = {part["id"]: part for part in PARTS}
    inner = poly([(230,514),(246,504),(269,499),(288,488),(300,482),(285,505),(275,529),(268,551),(269,569),(275,583),(261,594),(248,584),(236,567),(227,544)]) | poly([(704,279),(736,277),(767,289),(799,307),(829,326),(847,346),(849,370),(840,396),(826,421),(813,420),(806,397),(797,373),(783,344),(760,320),(734,301)])
    rr, gg, bb = (source[:,:,n].astype(np.float32) for n in range(3))
    crease = line([(273,530),(332,451),(414,378),(510,317),(614,281),(702,278),(785,324)], 14)
    inner |= crease & (rr > gg*1.65) & (rr-bb > 75)
    by_id["Hat_BackInner"]["candidate"] = inner
    by_id["Hat_BackInner"]["complete"] = inner
    bangs = poly([(349,453),(376,432),(399,401),(427,379),(443,371),(441,410),(428,442),(412,469),(388,493),(363,506),(339,511),(317,535),(304,534),(315,506),(326,478)])
    by_id["Hair_Bangs_R"]["candidate"] = bangs
    by_id["Hair_Bangs_R"]["complete"] = bangs
    cuff = poly([(531,1359),(558,1367),(602,1372),(643,1369),(664,1363),(682,1371),(691,1381),(687,1415),(670,1435),(648,1427),(598,1417),(541,1418),(515,1397),(521,1373)])
    by_id["Boot_Cuff_L"]["candidate"] = cuff
    by_id["Boot_Cuff_L"]["complete"] = cuff
    for offset,name in enumerate(("Arm_L_Upper","Arm_L_Lower","Hand_L")):
        by_id[name]["order"] = 290+offset
        by_id[name]["group_override"] = "Arms_Back"
    by_id["Arm_R_Upper"]["candidate"] = poly([(344,875),(367,880),(392,881),(414,893),(444,895),(471,885),(476,898),(468,919),(451,938),(416,951),(370,943),(344,929),(335,910),(336,891)])
    by_id["Arm_R_Upper"]["order"] = 330
    by_id["Arm_R_Upper"]["group_override"] = "Right_Upper_Sleeve"
    by_id["Arm_R_Upper"]["group_override_reason"] = "Visible right upper sleeve is above the olive torso but below the front cape; required for shoulder motion without gaps"
    for offset,name in enumerate(("Body_Base","Cape_Back")):
        by_id[name]["order"] = 250+offset
        by_id[name]["group_override"] = "Body_Foundation"
        by_id[name]["group_override_reason"] = "Hidden body and rear cape must remain behind both torso cloth and sleeve joints"
    for offset,name in enumerate(("Cape_R","Cape_L","Chest_Button")):
        by_id[name]["order"] = 350+offset
        by_id[name]["group_override"] = "Cape_Front"
        by_id[name]["group_override_reason"] = "Front short cape covers the upper sleeve; separate from olive torso behind that sleeve"
    by_id["Bodice_Olive"]["complete"] = poly([(400,768),(493,711),(611,701),(684,721),(718,780),(745,878),(713,935),(675,955),(585,958),(498,940),(403,940),(337,915),(339,849)])
    for name,donor_name,angle in (("Arm_L_Upper","Arm_R_Upper",65),("Arm_L_Lower","Arm_R_Lower",70),("Hand_L","Hand_R",0)):
        by_id[name]["donor_part"] = donor_name
        by_id[name]["donor_rotation"] = angle
    # Traced from the 4x enlarged approved tool crop, including actual tilted handle holes.
    left_outer=poly([(719,785),(732,787),(741,798),(749,818),(754,841),(751,855),(741,862),(730,865),(717,859),(706,846),(701,830),(699,812),(702,797),(710,788)])
    left_hole=poly([(719,798),(728,799),(734,809),(740,825),(744,840),(741,850),(735,853),(725,849),(718,839),(714,825),(711,811),(714,802)])
    right_outer=poly([(756,765),(769,760),(780,763),(788,775),(793,791),(797,811),(794,824),(786,834),(773,840),(762,836),(753,826),(746,808),(744,791),(747,775)])
    right_hole=poly([(761,776),(768,775),(774,781),(780,792),(785,810),(783,820),(776,829),(769,829),(761,816),(758,803),(756,788)])
    by_id["Tool_Scissors"]["candidate"] = (left_outer & ~left_hole) | (right_outer & ~right_hole) | poly([(746,851),(756,852),(766,879),(749,877)]) | poly([(769,833),(782,837),(774,880),(758,876)])
    by_id["Tool_Scissors"]["complete"] = by_id["Tool_Scissors"]["candidate"] | poly([(733,849),(745,847),(780,943),(770,954),(757,921)]) | poly([(763,831),(776,834),(758,912),(741,948),(733,941),(749,891)])
    for name in ("Hair_Bangs_Center","Hair_Bangs_R","Hair_Bangs_L","Hair_Side_R","Hair_Side_L"):
        expanded=np.asarray(Image.fromarray((by_id[name]["complete"]*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(45)))>0
        by_id[name]["complete"] = expanded
        by_id[name]["edge_extend_original"] = True
    # Donors deliberately avoid visible golden embroidery or the red hat lining.
    for name, rect in {
        "Cape_Back":(486,737,511,763), "Bodice_Olive":(624,841,640,866),
        "Hair_Bangs_R":(348,481,367,506), "Hair_BackMass":(279,575,319,628),
        "Hat_Leaves":(273,341,293,365), "Tool_PatternRoll":(813,745,824,775),
    }.items(): by_id[name]["donor"] = rect


def transformed_part_texture(source, donor_mask, target_mask, angle):
    donor_rgba=np.zeros_like(source); donor_rgba[donor_mask]=source[donor_mask]
    image=Image.fromarray(donor_rgba).crop(bbox(donor_mask)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if angle: image=image.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
    image=image.crop(image.getbbox())
    a=np.asarray(image).copy(); known=a[:,:,3]>=200; rgb=a[:,:,:3].copy()
    # Extend only the donor's small transparent margins with adjacent real cloth RGB.
    for _ in range(sum(known.shape)):
        if known.all(): break
        for axis,shift in ((0,1),(0,-1),(1,1),(1,-1)):
            shifted_known=np.roll(known,shift,axis=axis)
            if axis==0: shifted_known[0 if shift>0 else -1,:]=False
            else: shifted_known[:,0 if shift>0 else -1]=False
            fill=(~known)&shifted_known
            shifted_rgb=np.roll(rgb,shift,axis=axis); rgb[fill]=shifted_rgb[fill]; known[fill]=True
    target_box=bbox(target_mask); x0,y0,x1,y1=target_box
    resized=Image.fromarray(rgb).resize((x1-x0,y1-y0),Image.Resampling.BICUBIC)
    texture=np.zeros((H,W,3),dtype=np.uint8); texture[y0:y1,x0:x1]=np.asarray(resized)
    return texture, dict(sourcePart=donor_mask.sum().item(), sourceBounds=bbox(donor_mask), mirrorHorizontal=True, rotationDegrees=angle, outputBounds=target_box,
                        method="whole original opposite sleeve/mitten RGB, local mirror and affine resize; nearest donor-margin extension")


def extend_original_edges(source, owned, patch):
    bounds=bbox(owned|patch); x0,y0,x1,y1=bounds
    known=owned[y0:y1,x0:x1].copy() & (source[y0:y1,x0:x1,3]>=250)
    rgb=source[y0:y1,x0:x1,:3].copy()
    wanted=patch[y0:y1,x0:x1]
    for _ in range(sum(known.shape)):
        if (known|~wanted).all(): break
        for axis,shift in ((0,-1),(0,1),(1,1),(1,-1)):
            shifted_known=np.roll(known,shift,axis=axis)
            if axis==0: shifted_known[0 if shift>0 else -1,:]=False
            else: shifted_known[:,0 if shift>0 else -1]=False
            fill=(~known)&shifted_known
            shifted_rgb=np.roll(rgb,shift,axis=axis); rgb[fill]=shifted_rgb[fill]; known[fill]=True
    texture=np.zeros((H,W,3),dtype=np.uint8); texture[y0:y1,x0:x1]=rgb
    return texture


def checker(size, colors=((224,229,216),(239,241,231))):
    yy, xx = np.indices((size[1], size[0]))
    a = np.where(((xx//16+yy//16)%2)[...,None], colors[0], colors[1]).astype(np.uint8)
    return Image.fromarray(a).convert("RGBA")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-unfinished-face", action="store_true", help="Draft review only; do not assemble PSD from this pass.")
    args = parser.parse_args()
    source = np.asarray(Image.open(SOURCE).convert("RGBA"))
    assert source.shape == (H, W, 4)
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    wanted = {x["id"]: x for x in spec["layers"] if x["phase"] == "P0" and x["group"] != "Face"}
    define_parts()
    refine_material_boundaries(source)
    assert {p["id"] for p in PARTS} == set(wanted)
    for folder in ("layers", "source-visible", "masks/visible", "masks/patch", "review"):
        (OUT/folder).mkdir(parents=True, exist_ok=True)
    if not FACE.exists() and not args.allow_unfinished_face:
        raise SystemExit(f"Face ownership required before final separation: {FACE}")
    face = np.asarray(Image.open(FACE).convert("L")) > 0 if FACE.exists() else poly([(489,409),(565,374),(627,323),(684,331),(723,370),(750,418),(766,490),(752,537),(723,571),(678,593),(604,605),(545,596),(508,571),(489,530)]) | poly([(376,512),(410,506),(430,553),(424,580),(395,582),(374,556)]) | poly([(582,590),(645,587),(650,629),(580,632)])
    owners = np.full((H,W), -1, dtype=np.int16)
    for index, part in enumerate(PARTS):
        owners[part["candidate"] & (source[:,:,3] > 0)] = index
    owners[face & (source[:,:,3] > 0)] = -2
    unknown = (source[:,:,3] > 0) & (owners == -1)
    # Assign tiny fringe/seam pixels to the nearest inspected component, preserving all RGBA.
    expanded = (owners+3).astype(np.uint8)
    expanded[owners == -1] = 0
    for _ in range(max(W,H)):
        if not ((expanded == 0) & unknown).any(): break
        ring = np.asarray(Image.fromarray(expanded).filter(ImageFilter.MaxFilter(3)))
        expanded = np.where(expanded == 0, ring, expanded)
    if ((expanded == 0) & unknown).any(): raise RuntimeError("Unassigned source contour lies too far from any inspected part")
    owners[unknown] = expanded[unknown].astype(np.int16)-3
    original_owner = owners.copy()
    np.save(OUT/"masks/source-owner-index.npy", owners)
    Image.fromarray(np.where(owners == -2,255,0).astype(np.uint8)).save(OUT/"masks/face-reserved.png")
    metadata = []
    composite = Image.new("RGBA", (W,H))
    original_composite = Image.new("RGBA", (W,H))
    for index, part in enumerate(PARTS):
        own = owners == index
        # A bounded four-pixel seam extension also fills the hinge beneath a neighbour.
        desired = np.asarray(Image.fromarray((part["complete"]*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
        higher = np.zeros((H,W), dtype=bool)
        for other_index, other in enumerate(PARTS):
            if other["order"] > part["order"]: higher |= owners == other_index
        if part["order"] < 500: higher |= owners == -2
        # The approved PNG uses alpha 252/253 even in its interior. The user accepts
        # quantified +2/3 alpha from real overlapping production art; reference pixels stay exact.
        patch = desired & higher & (source[:,:,3] >= 252) & ~own
        rgba = np.zeros((H,W,4), dtype=np.uint8)
        rgba[own] = source[own]
        original_image = Image.fromarray(rgba.copy())
        original_composite.alpha_composite(original_image)
        if own.any(): original_image.save(OUT/f"source-visible/{part['id']}.png")
        if patch.any():
            if part.get("donor_part"):
                donor_index=next(i for i,p in enumerate(PARTS) if p["id"]==part["donor_part"])
                texture, transform=transformed_part_texture(source,(owners==donor_index)&(source[:,:,3]>=250),patch,part["donor_rotation"])
                transform["sourcePart"]=part["donor_part"]
                part["localDonorTransform"]=transform
            elif part.get("edge_extend_original"): texture=extend_original_edges(source,own,patch)
            else: texture = tiled_texture(source, part["donor"])
            rgba[patch,:3] = texture[patch]
            rgba[patch,3] = 255
        if not (rgba[:,:,3] > 0).any():
            raise RuntimeError(f"Refusing empty placeholder: {part['id']}")
        image = Image.fromarray(rgba)
        image.save(OUT/f"layers/{part['id']}.png")
        Image.fromarray((own*255).astype(np.uint8)).save(OUT/f"masks/visible/{part['id']}.png")
        Image.fromarray((patch*255).astype(np.uint8)).save(OUT/f"masks/patch/{part['id']}.png")
        composite.alpha_composite(image)
        metadata.append(dict(id=part["id"], group=part.get("group_override",wanted[part["id"]]["group"]), groupOverrideReason=part.get("group_override_reason","Place occluded left arm behind Body_Garment for correct cape occlusion") if part.get("group_override") else None,
            path=f"layers/{part['id']}.png", visible=True, opacity=1, order=part["order"],
            status="hidden_texture_reconstruction_requires_pose_review" if not own.any() else "original_pixel_separation_with_hidden_texture_patch_requires_pose_review",
            originalVisiblePixelCount=int(own.sum()), sourceVisiblePath=f"source-visible/{part['id']}.png" if own.any() else None,
            originalVisiblePath=f"source-visible/{part['id']}.png" if own.any() else None, neutralMask=f"masks/visible/{part['id']}.png",
            patchPixelCount=int(patch.sum()), nonzeroAlphaPixels=int((rgba[:,:,3]>0).sum()),
            sourceVisibleMask=f"masks/visible/{part['id']}.png", patchMask=f"masks/patch/{part['id']}.png", visibleBounds=bbox(own), patchBounds=bbox(patch),
            patchMethod="nearest visible original hair edge extension beneath hat for root coverage" if part.get("edge_extend_original") else "whole opposite sleeve/mitten local affine clone" if part.get("donor_part") else "direction-preserving local source RGB texture extension beneath a higher part with original alpha>=252",
            patchDonorRectangle=part["donor"], localDonorTransform=part.get("localDonorTransform"), notes=part["notes"], rgbaSha256=hashlib.sha256(rgba.tobytes()).hexdigest()))
    # Source face reference is used only in this QA composite, never exported as a rig layer.
    face_reference = np.zeros_like(source)
    face_reference[owners == -2] = source[owners == -2]
    composite = Image.new("RGBA",(W,H))
    for item in sorted(metadata+[dict(order=500,path=None)],key=lambda item:item["order"]):
        composite.alpha_composite(Image.open(OUT/item["path"]).convert("RGBA") if item["path"] else Image.fromarray(face_reference))
    original_composite.alpha_composite(Image.fromarray(face_reference))
    composite.save(OUT/"review/patched-body-plus-source-face.png")
    original_composite.save(OUT/"review/source-visible-body-plus-source-face.png")
    actual = np.asarray(composite)
    original_actual = np.asarray(original_composite)
    visible = source[:,:,3] > 0
    diff = np.abs(actual.astype(np.int16)-source.astype(np.int16))
    valid_equal = bool(np.array_equal(original_actual[visible], source[visible]) and np.array_equal(original_actual[:,:,3],source[:,:,3]))
    # Ignore RGB of fully transparent pixels, which has no rendered contribution.
    metrics = dict(sourceVisibleRgbaExact=valid_equal, patchedMaxVisibleChannelDifference=int(diff[visible].max()), patchedMaxRgbDifference=int(diff[:,:,:3][visible].max()),
        patchedMaxAlphaIncrease=int((actual[:,:,3].astype(np.int16)-source[:,:,3]).max()), patchedDifferingVisiblePixels=int(np.any(diff[visible] != 0,axis=1).sum()),
        patchedAlphaExact=bool(np.array_equal(actual[:,:,3],source[:,:,3])), unassignedSourcePixels=int(((owners == -1)&visible).sum()), nearestAssignedFringePixels=int(unknown.sum()), sourceFileAlphaUnchanged=True)
    for bgname, color in (("white",(255,255,255,255)),("pale-green",(224,234,216,255)),("deep-green",(26,53,37,255))):
        preview = Image.new("RGBA", (W,H), color); preview.alpha_composite(composite); preview.convert("RGB").save(OUT/f"review/neutral-{bgname}.png")
    # All parts individually shown against a checker; no part gets represented by an empty tile.
    columns, cellw, cellh = 6, 240, 250
    sheet = Image.new("RGB", (columns*cellw, ((len(metadata)+columns-1)//columns)*cellh), (241,242,235))
    draw = ImageDraw.Draw(sheet)
    for index,item in enumerate(metadata):
        im=Image.open(OUT/item["path"]).convert("RGBA"); box=im.getbbox(); crop=im.crop(box); crop.thumbnail((224,204))
        tile=checker((224,204)); tile.alpha_composite(crop,((224-crop.width)//2,(204-crop.height)//2))
        x,y=(index%columns)*cellw,(index//columns)*cellh
        sheet.paste(tile.convert("RGB"),(x+8,y+4)); draw.text((x+8,y+212),item["id"],fill=(25,45,30)); draw.text((x+8,y+229),f"original {item['originalVisiblePixelCount']} / patch {item['patchPixelCount']}",fill=(80,80,65))
    sheet.save(OUT/"review/body-contact-sheet.jpg",quality=93)
    # Focused material detail crops preserve enough scale to inspect original weave and seams.
    for name,ids in (("hat",[p["id"] for p in PARTS if p["id"].startswith("Hat_")]),("hair",[p["id"] for p in PARTS if p["id"].startswith(("Hair_","Braid_"))]),("boots",[p["id"] for p in PARTS if p["id"].startswith(("Boot_","Sock_"))]),("pouch",[p["id"] for p in PARTS if p["id"].startswith(("Pouch_","Tool_"))])):
        merged=Image.new("RGBA",(W,H))
        for item in metadata:
            if item["id"] in ids: merged.alpha_composite(Image.open(OUT/item["path"]).convert("RGBA"))
        crop=merged.crop(merged.getbbox()); bg=checker(crop.size); bg.alpha_composite(crop); bg.convert("RGB").save(OUT/f"review/{name}-material-review.png")
    stress_results = []
    stress_cases = [
        ("right-arm-up-left-15px", ["Arm_R_Upper","Arm_R_Lower","Hand_R"], -15,-15, (285,740,795,1050)),
        ("pouch-right-15px", [item["id"] for item in metadata if item["group"] == "Pouch"], 15,0, (660,730,950,1090)),
        ("hat-up-15px", [item["id"] for item in metadata if item["group"] == "Hat"], 0,-15, (180,180,910,650)),
        ("center-petal-right-15px", ["Skirt_Petal_Center"], 15,0, (190,910,910,1260)),
    ]
    for name,ids,dx,dy,roi in stress_cases:
        entries=[]
        for item in metadata:
            layer=Image.open(OUT/item["path"]).convert("RGBA")
            patch_image=Image.open(OUT/item["patchMask"]).convert("L")
            if item["id"] in ids:
                moved=Image.new("RGBA",(W,H)); moved.paste(layer,(dx,dy)); layer=moved
                moved_mask=Image.new("L",(W,H)); moved_mask.paste(patch_image,(dx,dy)); patch_image=moved_mask
            entries.append((item["order"],layer,np.asarray(patch_image)>0))
        entries.append((500,Image.fromarray(face_reference),EMPTY))
        stress=Image.new("RGBA",(W,H))
        for _,layer,_ in sorted(entries,key=lambda x:x[0]): stress.alpha_composite(layer)
        above=Image.new("RGBA",(W,H)); exposed=EMPTY.copy()
        for _,layer,patch_mask in sorted(entries,key=lambda x:x[0],reverse=True):
            exposed |= patch_mask & (np.asarray(above)[:,:,3] < 245)
            combined=layer.copy(); combined.alpha_composite(above); above=combined
        stress_array=np.asarray(stress)
        potential_holes=(source[:,:,3]>=252)&(stress_array[:,:,3]<245)
        x0,y0,x1,y1=roi
        report=dict(name=name, translationCssPixels=[dx,dy], inspectedRoi=list(roi), movedParts=ids,
            exposedReconstructedTexturePixels=int(exposed[y0:y1,x0:x1].sum()), vacatedOriginallyOpaquePixels=int(potential_holes[y0:y1,x0:x1].sum()),
            status="programmatic_translation_review_not_Cubism_motion_or_pose_acceptance",
            caveat="Vacated pixels can be legitimate silhouette movement. Magenta shows exposed reconstruction, cyan shows vacated alpha; human pose inspection is required.")
        stress_results.append(report)
        crop=stress.crop(roi); original_crop=composite.crop(roi)
        a=checker(crop.size); a.alpha_composite(original_crop)
        b=checker(crop.size); b.alpha_composite(crop)
        marked=stress_array.copy(); marked[exposed]=[255,0,180,255]; marked[potential_holes]=[0,220,240,255]
        c=checker(crop.size); c.alpha_composite(Image.fromarray(marked).crop(roi))
        panel=Image.new("RGB",(crop.width*3, crop.height+44),(240,241,234)); pd=ImageDraw.Draw(panel)
        for col,im,label in ((0,a,"Neutral patched candidate"),(1,b,f"PROGRAM TEST: {name}"),(2,c,"Magenta: exposed patch / cyan: vacated alpha")):
            panel.paste(im.convert("RGB"),(col*crop.width,44)); pd.text((col*crop.width+8,8),label,fill=(20,40,25))
        panel.save(OUT/f"review/stress-{name}.png")
    result=dict(schemaVersion=1, characterId="forest-spirit-approved-v2", stage="historical-separation-candidate", status="frozen_superseded_three_quarter_source_requires_approved_front_view", frozen=True,
        supersedingUserRequirement="Both face and body must face the camera fully front-on; await approved new front-facing master before new separation or production rigging", canvas=dict(width=W,height=H),
        source=str(SOURCE), sourceSha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(), sourceFileModified=False, faceOwnershipFile=str(FACE), faceOwnershipFinal=FACE.exists(),
        layers=metadata, neutralValidation=metrics, programmaticTranslationReviews=stress_results,
        knownUnpassedVisualIssues=[
            "Current approved-v2 master is three-quarter view and is superseded by the new front-facing requirement.",
            "Hat lift reveals coarse/root-color extension bands; not suitable for approved head or hat motion.",
            "Pouch translation exposes residual ring-edge material and repeated cloth patches; tool/cape isolation still needs refinement.",
            "Hidden sleeve clones are real source-derived pixels but show affine margin streaks and need artist/pose review.",
            "Large hidden rear-hair, bodice, cape and skirt patches retain repeated source texture patterns.",
            "The 15px tests are programmatic translations, not Cubism motions. Hat-touch requires a much larger verified shoulder/arm deformation.",
        ],
        remainingValidation=["Manual edge and hidden-texture quality review", "Hat-touch arm silhouette and joint continuity in Cubism", "Head-turn coverage", "Skirt and pouch overlap at motion extremes", "Production contour/hit polygon approval"],
        limitations=["Local texture clones in occluded areas are reproducible construction material, not a claim of newly hand-painted embroidery.","Some planned parts are wholly hidden in the flat master; their metadata records zero directly observed pixels and sourceVisiblePath=null, but their production PNG contains real reconstructed texture.","Source-visible PNGs preserve original RGBA. Hidden patches under originally alpha-252/253 material increase composited alpha by up to 3; actual RGB impact is quantified.","Fine outer alpha and source boundary color are deliberately preserved; no source-wide fringe cleanup.","Three requested skirt-petal IDs represent four approved visible lobes, with two viewer-left lobes kept together.","Visible long red tails attach to the braid bow in the actual source, despite historical Scarf IDs."])
    (OUT/"metadata.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(dict(parts=len(metadata),nonempty=True,output=str(OUT),validation=metrics),ensure_ascii=True))
    if not valid_equal: raise SystemExit("Neutral rendered pixels do not reconstruct source; inspect QA before assembly.")


if __name__ == "__main__": main()
