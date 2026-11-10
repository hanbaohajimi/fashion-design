"""Instrument calibration only. These tests cannot approve any art or Live2D model."""
from pathlib import Path
import importlib.util
import json
import unittest

import numpy as np
from PIL import Image

MODULE_PATH=Path(__file__).with_name("quality-v8.py")
module_spec=importlib.util.spec_from_file_location("quality_v8",MODULE_PATH)
quality=importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(quality)


class QualityV8Calibration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec=quality.load_frozen_spec()
        cls.reference=quality.ROOT/cls.spec["reference"]["path"]
        cls.image=np.asarray(Image.open(cls.reference).convert("RGBA")).copy()
        cls.root=quality.QUALITY_ROOT/"instrument-self-tests-union-mae-v2"
        cls.fixtures=cls.root/"fixtures"
        cls.fixtures.mkdir(parents=True,exist_ok=True)
        cls.results=[]

    @classmethod
    def tearDownClass(cls):
        (cls.root/"self-test-results.json").write_text(json.dumps({
            "evidenceType":"instrument_calibration_only_not_model_acceptance", "specSha256":quality.FROZEN_SPEC_SHA256,
            "cases":cls.results, "modelAcceptance":"not_evaluated",
        },indent=2)+"\n",encoding="utf-8")

    def compare(self,name,image,expected):
        path=self.fixtures/f"{name}.png"
        Image.fromarray(image).save(path)
        report=quality.run_quality(path,self.root/name,purpose="instrument-self-test")
        actual=report["metrics"]["numericThresholdsPassed"]
        self.results.append({"case":name,"expectedNumericPass":expected,"observedNumericPass":actual,
                             "report":str(self.root/name/"report.json"),"correct":actual==expected})
        self.assertEqual(actual,expected)
        self.assertEqual(report["modelAcceptance"],"not_evaluated")
        self.assertEqual(report["evidenceType"],"instrument_self_test_not_model_evidence")
        return report["metrics"]

    def test_01_identity_is_calibration_only(self):
        metrics=self.compare("same-image",self.image,True)
        self.assertEqual(metrics["alpha"]["iou"],1.0)
        self.assertEqual(metrics["alpha"]["normalizedMae"],0.0)
        self.assertEqual(metrics["deltaE00"]["regions"]["union"]["p95"],0.0)
        for background in metrics["ssim"]["backgrounds"].values():
            self.assertAlmostEqual(background["global"]["score"],1.0,places=12)

    def test_02_missing_eye_cannot_hide_in_large_global_average(self):
        candidate=self.image.copy()
        region=next(item for item in self.spec["regions"] if item["id"]=="eye_R")
        left,top,right,bottom=region["rect"]
        candidate[top:bottom,left:right]=0
        metrics=self.compare("missing-right-eye",candidate,False)
        self.assertTrue(all(bg["global"]["passed"] for bg in metrics["ssim"]["backgrounds"].values()))
        self.assertTrue(all(not bg["regions"]["eye_R"]["passed"] for bg in metrics["ssim"]["backgrounds"].values()))

    def test_03_wrong_alignment_is_not_registered_away(self):
        candidate=np.zeros_like(self.image)
        candidate[:,12:]=self.image[:,:-12]
        metrics=self.compare("translated-right-12px",candidate,False)
        self.assertFalse(metrics["ssim"]["passed"])
        self.assertFalse(metrics["registrationApplied"])

    def test_04_wrong_material_color_fails_delta_e(self):
        candidate=self.image.copy()
        rgb=candidate[:,:,:3].astype(np.int16)
        rgb[:,:,0]+=40
        rgb[:,:,1]-=22
        candidate[:,:,:3]=np.clip(rgb,0,255).astype(np.uint8)
        metrics=self.compare("red-green-color-shift",candidate,False)
        self.assertFalse(metrics["deltaE00"]["passed"])
        self.assertGreater(metrics["deltaE00"]["regions"]["union"]["median"],3.0)

    def test_05_size_mismatch_rejected(self):
        path=self.fixtures/"wrong-size.png"
        Image.fromarray(self.image[:,:-1]).save(path)
        with self.assertRaisesRegex(ValueError,"Fixed canvas required"):
            quality.load_rgba(path,self.spec["reference"]["width"],self.spec["reference"]["height"])
        self.results.append({"case":"size-mismatch","correct":True,"behavior":"rejected; no resize"})

    def test_06_roi_cannot_be_shrunk_after_a_failure(self):
        modified=json.loads(quality.SPEC_PATH.read_text(encoding="utf-8"))
        modified["regions"][0]["rect"]=[400,450,410,460]
        path=self.fixtures/"tampered-spec.json"
        path.write_text(json.dumps(modified),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"Frozen quality specification hash differs"):
            quality.load_frozen_spec(path)
        self.results.append({"case":"tampered-roi","correct":True,"behavior":"frozen hash rejected changed ROI"})

    def test_07_transparent_padding_cannot_dilute_foreground_alpha_error(self):
        reference=np.zeros((20,20),dtype=np.float64)
        candidate=reference.copy()
        reference[5:15,5:15]=1.0
        candidate[5:15,5:15]=0.5
        compact=quality.alpha_metrics(reference,candidate,np.ones(reference.shape,dtype=bool),0.5,0.05)
        padded_reference=np.pad(reference,190)
        padded_candidate=np.pad(candidate,190)
        padded=quality.alpha_metrics(padded_reference,padded_candidate,np.ones(padded_reference.shape,dtype=bool),0.5,0.05)
        self.assertEqual(compact["normalizedMae"],0.5)
        self.assertEqual(padded["normalizedMae"],compact["normalizedMae"])
        self.assertEqual(padded["samplePixels"],compact["samplePixels"])
        self.assertGreater(padded["iouScopePixels"],compact["iouScopePixels"])
        self.results.append({"case":"transparent-padding-invariance","correct":True,"compactMae":compact["normalizedMae"],"paddedMae":padded["normalizedMae"],"foregroundSamples":padded["samplePixels"]})

    def test_08_later_artist_save_does_not_change_frozen_input(self):
        source=self.fixtures/"snapshot-source.png"
        target=self.fixtures/"snapshot-frozen.png"
        source.write_bytes(self.reference.read_bytes())
        receipt=quality.copy_frozen_input(source,target)
        modified=self.image.copy()
        modified[450:520,400:450,3]=0
        Image.fromarray(modified).save(source)
        self.assertNotEqual(quality.sha256(source),receipt["sha256"])
        self.assertEqual(quality.sha256(target),receipt["sha256"])
        self.assertEqual(quality.sha256(target),self.spec["reference"]["sha256"])
        self.results.append({"case":"stable-input-snapshot","correct":True,"behavior":"later source save cannot change scored snapshot bytes"})


if __name__=="__main__": unittest.main(verbosity=2)
