function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => [key, stableObject(value[key])]),
  );
}

function stableKey(value) {
  return JSON.stringify(stableObject(value));
}

function sortObjects(values, key) {
  values.sort((left, right) => key(left).localeCompare(key(right), "en"));
}

export function canonicalizeSbom(input, { npmVersion }) {
  const sbom = structuredClone(input);
  if (!sbom.metadata || typeof sbom.metadata !== "object") {
    throw new Error("SBOM metadata is required");
  }
  delete sbom.metadata.timestamp;

  const tools = sbom.metadata.tools?.components;
  if (!Array.isArray(tools)) throw new Error("SBOM generator tools are required");
  const npmTool = tools.find((component) => component.name === "npm");
  if (!npmTool) throw new Error("SBOM npm tool identity is required");
  npmTool.version = npmVersion;

  sortObjects(tools, (component) => `${component.group ?? ""}/${component.name ?? ""}@${component.version ?? ""}`);
  sortObjects(sbom.components ?? [], (component) => component["bom-ref"] ?? stableKey(component));
  sortObjects(sbom.dependencies ?? [], (dependency) => dependency.ref ?? stableKey(dependency));

  const normalizeArrays = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) normalizeArrays(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value.dependsOn)) value.dependsOn.sort((left, right) => left.localeCompare(right, "en"));
    for (const key of ["externalReferences", "licenses", "properties"]) {
      if (Array.isArray(value[key])) sortObjects(value[key], stableKey);
    }
    for (const child of Object.values(value)) normalizeArrays(child);
  };
  normalizeArrays(sbom);
  return stableObject(sbom);
}

export function serializeCanonicalSbom(sbom) {
  return Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`, "utf8");
}
