"""Tests for validation scripts only. Fixtures are NOT actual Cubism models."""
from __future__ import annotations
import base64
import json
from pathlib import Path
import tempfile
import unittest
from check_handoff import check as check_handoff
from check_runtime import check as check_runtime


class ChecksTest(unittest.TestCase):
    def test_handoff(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(check_handoff(root)['result'], 'PASS')

    def fixture(self, root: Path) -> Path:
        # Deliberately synthetic binary: only tests file-reference plumbing.
        (root/'test.moc3').write_bytes(b'NOT_A_REAL_MODEL')
        (root/'tex.png').write_bytes(base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII='))
        (root/'physics.json').write_text('{"Version":3}', encoding='utf-8')
        (root/'motion.json').write_text(json.dumps({'Version':3,'Curves':[{'Target':'Parameter','Id':'ParamAngleX','Segments':[0,0]}]}),encoding='utf-8')
        obj={'Version':3,'FileReferences':{'Moc':'test.moc3','Textures':['tex.png'],'Physics':'physics.json',
              'Motions':{g:[{'File':'motion.json'}] for g in ['Idle','Hover','DragHold','PutDown']}}}
        entry=root/'test.model3.json'
        entry.write_text(json.dumps(obj),encoding='utf-8')
        return entry

    def test_reference_only_success_is_not_model_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=check_runtime(self.fixture(Path(tmp)))
            self.assertEqual(result['result'],'REFERENCES_OK_NOT_CORE_VALIDATED')
            self.assertTrue(any('NOT parsed' in s for s in result['warnings']))

    def test_missing_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(check_runtime(Path(tmp)/'missing.model3.json')['result'],'FAIL')

    def test_missing_texture(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); entry=self.fixture(root)
            (root/'tex.png').unlink()
            self.assertEqual(check_runtime(entry)['result'],'FAIL')

    def test_traversal_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); entry=self.fixture(root)
            obj=json.loads(entry.read_text())
            obj['FileReferences']['Moc']='../outside.moc3'
            entry.write_text(json.dumps(obj),encoding='utf-8')
            self.assertEqual(check_runtime(entry)['result'],'FAIL')

    def test_empty_motion_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); entry=self.fixture(root)
            (root/'motion.json').write_text('{"Version":3,"Curves":[]}',encoding='utf-8')
            self.assertEqual(check_runtime(entry)['result'],'FAIL')

    def test_required_group_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); entry=self.fixture(root)
            obj=json.loads(entry.read_text())
            del obj['FileReferences']['Motions']['Hover']
            entry.write_text(json.dumps(obj),encoding='utf-8')
            self.assertEqual(check_runtime(entry)['result'],'FAIL')


if __name__=='__main__':
    unittest.main(verbosity=2)
