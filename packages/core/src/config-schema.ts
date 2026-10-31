// Browser-safe entry (`@pullup/core/config-schema`): the config schema, field
// registry, presets, free-text screen and authority modes — everything the
// settings UI needs to validate and label a draft exactly as the server will.
// Nothing here imports node built-ins.

export * from "./config/schema.js";
export * from "./config/guardrails.js";
export * from "./config/presets.js";
export * from "./config/fields.js";
export * from "./config/screen.js";
export * from "./policy/categories.js";
export * from "./actions/authority.js";
export * from "./config/severity.js";
export * from "./config/rules.js";
export * from "./config/checks.js";
export * from "./config/inline.js";
export * from "./config/walkthroughs.js";
export * from "./config/verify.js";
export * from "./config/outcomes.js";
export * from "./findings/findings.js";
export type * from "./verify/types.js";
export type * from "./outcomes/derive.js";
export type * from "./outcomes/learn.js";
export { globToRegExp, matchesAny } from "./policy/policy.js";
export { tierOfPath } from "./policy/guardrails.js";
export type { CustomQuestion, JevConfig, JevMode, JevThresholds } from "./signals/config.js";
