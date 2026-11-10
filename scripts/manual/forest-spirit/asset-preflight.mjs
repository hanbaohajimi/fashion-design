export const motionNames = ["idle", "hover_greet", "drag_hold", "put_down"];

export function resourceUrl(reference, modelUrl) {
  if (typeof reference !== "string" || !reference || reference.includes("\\")) throw new Error("Invalid Cubism resource reference");
  const url = new URL(reference, modelUrl);
  if (url.origin !== new URL(modelUrl).origin || !/^https?:$/u.test(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error("Cubism resources must be served from the same origin");
  return url.href;
}

export function inspectModelPackage(model, modelUrl, motionUrls) {
  const neutral = inspectNeutralModelPackage(model, modelUrl);
  const refs = model?.FileReferences;
  if (typeof refs.Physics !== "string" || !refs.Physics.endsWith(".physics3.json")) throw new Error("Required physics3.json is missing");
  const exported = new Set(Object.values(refs.Motions ?? {}).flat().map(entry => resourceUrl(entry.File, modelUrl)));
  const motions = Object.fromEntries(motionNames.map(name => {
    const url = resourceUrl(motionUrls?.[name], modelUrl);
    if (!url.endsWith(".motion3.json") || !exported.has(url)) throw new Error(`Required ${name} motion is not exported by model3.json`);
    return [name, url];
  }));
  if (new Set(Object.values(motions)).size !== motionNames.length) throw new Error("Four distinct authored motions are required");
  return { ...neutral, physics: resourceUrl(refs.Physics, modelUrl), motions };
}

/** Isolated neutral capture accepts an unfinished real model, never a stand-in PNG. */
export function inspectNeutralModelPackage(model, modelUrl) {
  const refs = model?.FileReferences;
  if (model?.Version !== 3 || typeof refs?.Moc !== "string" || !refs.Moc.endsWith(".moc3")) throw new Error("A real model3.json and moc3 reference are required");
  if (!Array.isArray(refs.Textures) || !refs.Textures.length || !refs.Textures.every(texture => typeof texture === "string" && texture.endsWith(".png"))) throw new Error("Model PNG textures are missing");
  return { moc: resourceUrl(refs.Moc, modelUrl), textures: refs.Textures.map(file => resourceUrl(file, modelUrl)) };
}

export function inspectMotion(motion, name) {
  if (motion?.Version !== 3 || !(motion.Meta?.Duration > 0) || !Array.isArray(motion.Curves) || !motion.Curves.some(curve => curve.Target === "Parameter" && Array.isArray(curve.Segments) && curve.Segments.length > 2)) throw new Error(`${name} has no authored parameter animation`);
  return motion.Curves.filter(curve => curve.Target === "Parameter").map(curve => curve.Id);
}

export function inspectPhysics(physics) {
  if (physics?.Version !== 3 || !Array.isArray(physics.PhysicsSettings) || !physics.PhysicsSettings.length || !physics.PhysicsSettings.some(setting => setting.Input?.length && setting.Output?.length && setting.Vertices?.length > 1)) throw new Error("Physics file has no authored simulation settings");
  return physics.PhysicsSettings.flatMap(setting => (setting.Output ?? []).map(output => output.Destination?.Id));
}

/** Cubism exports constant neutral curves too; only changing curves compete with physics. */
export function animatedParameters(motion) {
  return motion.Curves.filter(curve => {
    if (curve.Target !== "Parameter") return false;
    const values = curve.Segments;
    const initial = values[1];
    for (let index = 2; index < values.length;) {
      const type = values[index];
      if (type === 1) {
        if ([values[index + 2], values[index + 4], values[index + 6]].some(value => value !== initial)) return true;
        index += 7;
      } else if ([0, 2, 3].includes(type)) {
        if (values[index + 2] !== initial) return true;
        index += 3;
      } else throw new Error("Unknown Cubism motion segment type");
    }
    return false;
  }).map(curve => curve.Id);
}
