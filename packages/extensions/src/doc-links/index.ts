import { defineExtension, type Note } from "@pullup/sdk";
import { z } from "zod";

/**
 * Reviewer help that never changes a result: links to design documents that
 * mention a changed file (Google's Elephant-Goldfish Model, ideas 1 and 2) and
 * to diffmap walkthrough specs the pull request changes, pinned to the head
 * commit. File names are written by the pull request's author, so only paths
 * whose parts are `[A-Za-z0-9._-]` are linked (no Markdown injection).
 */

const schema = z.object({
  /** Folder of design documents, read from the head commit so a pull request can bring its own. */
  designDocs: z.string().min(1).default("docs/designs"),
  /** Walkthrough specs (diffmap's living specs). */
  specs: z.string().min(1).default("specs"),
  maxLinks: z.number().int().min(1).max(10).default(3),
});

const SAFE_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.mdx?$/;
const HEX_SHA = /^[0-9a-f]{7,40}$/;

const link = (repo: string, sha: string, path: string) => `https://github.com/${repo}/blob/${sha}/${path}`;

export default defineExtension({
  id: "doc-links",
  version: "1.0.0",
  title: "Design docs and walkthroughs",
  summary: "Links design documents that mention a changed file and walkthrough specs the change edits. Notes only: it never changes a result.",
  config: {
    schema,
    fields: [
      { key: "designDocs", label: "Design documents folder", help: "Markdown files here that mention a changed file are linked.", kind: "text", loosens: false },
      { key: "specs", label: "Walkthrough specs folder", help: "Changed .md or .mdx files here are linked (diffmap specs).", kind: "text", loosens: false },
      { key: "maxLinks", label: "At most this many links", help: "Per kind of link.", kind: "number", loosens: false },
    ],
  },
  reads: (config) => [{ from: "head", globs: [`${config.designDocs}/**/*.md`, `${config.designDocs}/**/*.mdx`] }],
  notes({ config, diff, files, run }) {
    if (!HEX_SHA.test(run.headSha)) return [];
    const notes: Note[] = [];
    // Changed paths are written by the author and end up in Markdown, so only plain ones are named.
    const changed = diff.filter((f) => f.status !== "deleted").map((f) => f.path).filter((p) => /^[A-Za-z0-9._/-]+$/.test(p));
    const docs = files
      .filter((f) => SAFE_PATH.test(f.path))
      .map((f) => ({ path: f.path, mentions: changed.filter((c) => c !== f.path && f.text.includes(c)) }))
      .filter((d) => d.mentions.length)
      .slice(0, config.maxLinks);
    for (const d of docs) notes.push({ text: `Design doc ${d.path} describes ${d.mentions.slice(0, 3).join(", ")}`, link: link(run.repo, run.headSha, d.path) });
    const specs = changed.filter((p) => p.startsWith(`${config.specs}/`) && SAFE_PATH.test(p)).slice(0, config.maxLinks);
    for (const p of specs) notes.push({ text: `Walkthrough: ${p}`, link: link(run.repo, run.headSha, p) });
    return notes;
  },
});
