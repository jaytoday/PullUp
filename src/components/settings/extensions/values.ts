/** Reading and writing a setting by its dotted key (`triggers.flaky-test.enabled`) without changing the original. */

export type Section = Record<string, unknown>;

export function getPath(value: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Section)[k] : undefined), value);
}

export function setPath(section: Section, key: string, value: unknown): Section {
  const [head, ...rest] = key.split(".");
  if (!rest.length) return { ...section, [head!]: value };
  const child = section[head!];
  return { ...section, [head!]: setPath(child && typeof child === "object" ? (child as Section) : {}, rest.join("."), value) };
}

/** A list as one line of text: "a, b". */
export const listText = (value: unknown) => (Array.isArray(value) ? value.join(", ") : "");
export const parseList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

/** A name → value map as one line of text: "@alice = alice@example.com, @bob = bob@example.com". */
export const mapText = (value: unknown) =>
  value && typeof value === "object" ? Object.entries(value as Record<string, string>).map(([k, v]) => `${k} = ${v}`).join(", ") : "";
export const parseMap = (text: string) =>
  Object.fromEntries(
    parseList(text)
      .map((pair) => pair.split("=").map((s) => s.trim()))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  );
