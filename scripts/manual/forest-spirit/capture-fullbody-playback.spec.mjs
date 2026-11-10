import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { auditPlaybackTrace, listenOnDiagnosticPort, routePlaybackPackage } from "./capture-fullbody-playback.mjs";
import { freezeCompletedCheckpoint } from "./fullbody-playback-page.mjs";

// Synthetic report records test the *auditor*, not Core, rendering or a model.
// No mock model/image/animation file is generated or presented as real output.
const bounds = { ParamFSPickup: { minimum: 0, maximum: 1 }, PhysicsOnly: { minimum: -1, maximum: 1 } };
const drawableIds = Array.from({ length: 72 }, (_, i) => `SyntheticAuditorId_${i}`);
function observationFixture() {
  const ids = ["160", "220", "280", "zoom"], phases = ["idle-loop", "hover-complete", "drag-hold-complete", "put-down-complete", "interrupt-hover-with-drag", "interrupt-put-down-with-hover", "final-idle"];
  const playbackPolicy = Object.fromEntries(["idle", "hover_greet", "drag_hold", "put_down"].map(id => [id, { loop: id === "idle", fadeIn: id === "drag_hold" ? 0 : .12, fadeOut: id === "drag_hold" ? 0 : .12 }]));
  return {
    done: true, errors: [], instances: ids.map(id => ({ id, playbackPolicy })), physicsIds: ["PhysicsOnly"],
    frames: ids.flatMap(instance => phases.map((phase, index) => ({ instance, phase, dt: 1 / 30, drawCompletedMs: index * 40, order: ["load", "motion", "save", "physics"], parameters: { ParamFSPickup: 0, PhysicsOnly: index * .01 }, drawables: drawableIds.map(id => ({ id, finiteVertices: true, vertexCount: 4, opacity: 1, renderOrder: 500, canvasBounds: [0, 0, 10, 10] })) }))),
    holds: [0, 1].map(() => ({ instances: ids.map(id => ({ id, parametersUnchanged: true, geometryUnchanged: true, noNewRenderedFrame: true, stopped: true, pickup: 1 })) })),
    events: [
      ...["hover-complete", "put-down-complete"].flatMap(reason => ids.map(instance => ({ type: "promise-resolved", instance, reason, state: { current: "idle" } }))),
      ...[["interrupt-hover-with-drag", "hover_greet"], ["interrupt-put-down-with-hover", "put_down"]].map(([reason, current]) => ({ type: "command", reason, before: ids.map(id => ({ id, current, finished: false })) })),
    ],
  };
}
const failures = (proof, expectedIds = drawableIds) => auditPlaybackTrace(proof, bounds, expectedIds).filter(check => !check.passed).map(check => check.name);

test("routing preserves original descriptor and registers four distinct real-resource routes", () => {
  const model = { Version: 3, FileReferences: { Moc: "actual.moc3", Textures: ["textures/actual.png"] } }, before = JSON.stringify(model);
  const motions = Object.fromEntries(["idle", "hover_greet", "drag_hold", "put_down"].map(name => [name, `/motions/${name}.motion3.json`]));
  const routing = routePlaybackPackage(model, "/model/original.model3.json", "/physics/candidate.physics3.json", motions);
  assert.equal(JSON.stringify(model), before); assert.equal(routing.FileReferences.Moc, "/model/actual.moc3"); assert.equal(routing.FileReferences.Physics, "/physics/candidate.physics3.json");
  assert.throws(() => routePlaybackPackage(model, "/model/original.model3.json", "/physics/candidate.physics3.json", { ...motions, drag_hold: motions.idle }), /distinct/);
  assert.throws(() => routePlaybackPackage({ ...model, FileReferences: { ...model.FileReferences, Moc: "https://outside.invalid/a.moc3" } }, "/model/original.model3.json", "/physics/candidate.physics3.json", motions), /same origin/);
});

test("complete synthetic observation passes auditor only", () => assert.deepEqual(failures(observationFixture()), []));
test("explicit 73-drawable inventory is checked by identity on every frame", () => {
  const proof = observationFixture(), splitId = "SyntheticAuditorSplit";
  for (const frame of proof.frames) frame.drawables.push({ ...frame.drawables[0], id: splitId });
  assert.deepEqual(failures(proof, [...drawableIds, splitId]), []);
  assert.ok(failures(proof).some(name => name.includes("finite actual geometry")));
  proof.frames[1].drawables[0].id = splitId;
  assert.ok(failures(proof, [...drawableIds, splitId]).some(name => name.includes("finite actual geometry")));
});
test("incorrect motion/save/physics order and absent physics cannot pass", () => {
  const proof = observationFixture(); proof.frames[0].order = ["load", "motion", "physics", "save"]; for (const frame of proof.frames) frame.parameters.PhysicsOnly = 0;
  const failed = failures(proof); assert.ok(failed.some(name => name.includes("load -> motion"))); assert.ok(failed.some(name => name.includes("actual output varied")));
});
test("finished hold reset or extra renderer activity is rejected", () => {
  const proof = observationFixture(); proof.holds[0].instances[1].parametersUnchanged = false; proof.holds[1].instances[2].noNewRenderedFrame = false;
  assert.ok(failures(proof).includes("both actual DragHold pauses preserved end pose without rendering/reset"));
});
test("a resolved interrupted promise does not prove natural completion", () => {
  const proof = observationFixture(); proof.events[0].state.current = "drag_hold"; proof.events.at(-1).before[0].finished = true;
  assert.ok(failures(proof).some(name => name.includes("naturally returns"))); assert.ok(failures(proof).some(name => name.includes("previous action was still active")));
});
test("missing frames, invalid geometry and out-of-range parameters fail closed", () => {
  const proof = observationFixture(); proof.frames = proof.frames.filter(frame => frame.instance !== "zoom"); proof.frames[0].drawables[0].canvasBounds[0] = Infinity; proof.frames[1].parameters.PhysicsOnly = 2;
  const failed = failures(proof); assert.ok(failed.some(name => name.startsWith("zoom: actual production"))); assert.ok(failed.some(name => name.includes("finite actual geometry"))); assert.ok(failed.some(name => name.includes("approved bounds")));
});
test("constant nonzero physics and one unresponsive instance are not variation", () => {
  const proof = observationFixture(); for (const frame of proof.frames.filter(frame => frame.instance === "220")) frame.parameters.PhysicsOnly = .1;
  assert.ok(failures(proof).includes("220/PhysicsOnly: actual output varied"));
});
test("bounded diagnostic ports retry occupied ports and clean listeners", async () => {
  const server = new EventEmitter(), ports = [];
  server.listen = (port, host) => { ports.push(port); assert.equal(host, "127.0.0.1"); queueMicrotask(() => port === 48270 ? server.emit("error", Object.assign(new Error("busy"), { code: "EADDRINUSE" })) : server.emit("listening")); };
  assert.equal(await listenOnDiagnosticPort(server), 48271); assert.deepEqual(ports, [48270, 48271]); assert.equal(server.listenerCount("error"), 0); assert.equal(server.listenerCount("listening"), 0);
});
test("checkpoint freezes metadata, vertex bytes and image strings before any async boundary", async () => {
  // These labels are mock return strings for the freeze helper, not image data.
  let label = "unit-frame-7";
  const canvas = { toDataURL: () => label }, bytes = new Float32Array([1, 2, 3, 4]);
  const instance = { id: "220", lastCompletedFrame: { state: { frameCounter: 7, parameters: { ParamFSPickup: 1 } }, wallElapsedMs: 1250, bytes: bytes.buffer }, cache: canvas, contexts: [{ background: "white", canvas }], rois: [{ id: "face", canvas }] };
  const control = { current: null, raf: 0, parameters: { ParamFSPickup: 1 } };
  const frozen = freezeCompletedCheckpoint(instance, "hold", 1300, control);
  await Promise.resolve(); // Stand in for a later RAF or asynchronous digest.
  label = "unit-frame-8"; instance.lastCompletedFrame.state.frameCounter = 8; instance.lastCompletedFrame.state.parameters.ParamFSPickup = 0; bytes[0] = 100; control.parameters.ParamFSPickup = 0;
  assert.equal(frozen.state.frameCounter, 7); assert.equal(frozen.state.parameters.ParamFSPickup, 1); assert.equal(frozen.controlState.parameters.ParamFSPickup, 1); assert.equal(new Float32Array(frozen.bytes)[0], 1);
  assert.ok(frozen.images.every(image => image.pngDataUrl === "unit-frame-7" && image.sourceFrameCounter === 7 && image.sourceFrameWallElapsedMs === 1250));
});
