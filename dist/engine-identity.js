// Resume provenance contains only the public provider id and local model name.
// Never copy provider settings: endpoints, tokens and API keys are not document data.
const engines = new Set([
  "browser",
  "wasm",
  "plamo",
  "gemma",
  "ollama",
  "google",
  "gas",
]);
const configurableModels = new Set(["plamo", "gemma", "ollama"]);

export function normalizeEngineIdentity(value) {
  if (!value || !engines.has(value.engine)) return undefined;
  if (!configurableModels.has(value.engine)) return { engine: value.engine };
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(model) ||
    /^[a-z]+:\/\//i.test(model)
  )
    return undefined;
  return { engine: value.engine, model };
}

export function canResumeWithEngine(previous, current, legacyLabel = "") {
  const selected = normalizeEngineIdentity(current);
  if (!selected) return false;
  const saved = normalizeEngineIdentity(previous);
  if (saved)
    return saved.engine === selected.engine && saved.model === selected.model;
  // Old v1 files did not record a configurable Ollama model. Its identity cannot
  // be recovered from a display label, so begin a fresh job for those files.
  return (
    !configurableModels.has(selected.engine) && legacyLabel === current.label
  );
}
