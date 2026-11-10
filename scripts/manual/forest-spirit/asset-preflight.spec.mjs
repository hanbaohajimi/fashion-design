import assert from "node:assert/strict";
import test from "node:test";
import { animatedParameters, inspectModelPackage, inspectNeutralModelPackage, inspectMotion, inspectPhysics, resourceUrl } from "./asset-preflight.mjs";

// Schema fixtures only. These objects are never exported as production motions/models.
const url = "https://test.invalid/forest/model.model3.json";
const motions = Object.fromEntries(["idle", "hover_greet", "drag_hold", "put_down"].map(name => [name, `/forest/${name}.motion3.json`]));
const fixture = () => ({ Version: 3, FileReferences: { Moc: "model.moc3", Textures: ["texture.png"], Physics: "model.physics3.json", Motions: { Actions: Object.values(motions).map(File => ({ File })) } } });

test("resolves only same-origin resources", () => {
  assert.equal(resourceUrl("texture.png", url), "https://test.invalid/forest/texture.png");
  for (const source of ["https://other.invalid/x", "//other.invalid/x", "data:text/plain,x", "x?query", "a\\b", undefined]) assert.throws(() => resourceUrl(source, url));
});
test("requires the real physics and all four exported distinct motion references", () => {
  assert.equal(inspectModelPackage(fixture(), url, motions).textures.length, 1);
  const missingPhysics = fixture(); delete missingPhysics.FileReferences.Physics;
  assert.throws(() => inspectModelPackage(missingPhysics, url, motions), /physics3/);
  const missingMotion = fixture(); missingMotion.FileReferences.Motions.Actions.pop();
  assert.throws(() => inspectModelPackage(missingMotion, url, motions), /put_down/);
  assert.throws(() => inspectModelPackage(fixture(), url, { ...motions, put_down: motions.idle }), /distinct/);
});
test("empty animation and empty physics cannot satisfy delivery checks", () => {
  assert.throws(() => inspectMotion({ Version: 3, Meta: { Duration: 3 }, Curves: [] }, "hover_greet"), /authored/);
  assert.throws(() => inspectPhysics({ Version: 3, PhysicsSettings: [] }), /authored/);
  assert.deepEqual(inspectMotion({ Version: 3, Meta: { Duration: 1 }, Curves: [{ Target: "Parameter", Id: "ParamAngleZ", Segments: [0, 0, 0, 1, 2] }] }, "fixture"), ["ParamAngleZ"]);
});

test("neutral diagnostic still requires a real model while production keeps the full gate", () => {
  const headStage = { Version: 3, FileReferences: { Moc: "head.moc3", Textures: ["head.2048/texture_00.png"] } };
  assert.equal(inspectNeutralModelPackage(headStage, url).moc, "https://test.invalid/forest/head.moc3");
  assert.throws(() => inspectModelPackage(headStage, url, motions), /physics3/);
  assert.throws(() => inspectNeutralModelPackage({ Version: 3, FileReferences: { Moc: "reference.png", Textures: ["reference.png"] } }, url), /moc3/);
  assert.throws(() => inspectNeutralModelPackage({ ...headStage, FileReferences: { ...headStage.FileReferences, Textures: ["https://other.invalid/texture.png"] } }, url), /same origin/);
});

test("physics ownership allows exported constant curves but detects animated Bezier and stepped curves", () => {
  const motion = { Curves: [
    { Target: "Parameter", Id: "ConstantHair", Segments: [0, 0, 1, 0.3, 0, 0.6, 0, 1, 0, 0, 2, 0] },
    { Target: "Parameter", Id: "MovingHair", Segments: [0, 0, 1, 0.3, 0, 0.6, 1, 1, 0] },
    { Target: "Parameter", Id: "Stepped", Segments: [0, 0, 2, 1, 1] },
  ] };
  assert.deepEqual(animatedParameters(motion), ["MovingHair", "Stepped"]);
});
