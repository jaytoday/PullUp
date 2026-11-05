import type { Extension } from "@pullup/sdk";
import codeowners from "./codeowners";
import core from "./core";
import inert from "./inert";
import docLinks from "./doc-links";
import repoRules from "./repo-rules";
import threatModel from "./threat-model";

/**
 * Every bundled extension, in the order they run when the repository's config
 * does not say otherwise. Adding an extension is a folder in `src/` and one
 * line here.
 */
export const BUNDLED: readonly Extension[] = [core, repoRules, threatModel, codeowners, docLinks, inert];

let registry: readonly Extension[] = BUNDLED;

export function allExtensions(): readonly Extension[] {
  return registry;
}

export function extensionById(id: string): Extension | undefined {
  return registry.find((e) => e.id === id);
}

/** Tests only: use other extensions (for example a hostile fake). Returns a function that puts the bundled ones back. */
export function replaceExtensionsForTest(list: readonly Extension[]): () => void {
  registry = list;
  return () => {
    registry = BUNDLED;
  };
}
