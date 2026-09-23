import { describe, expect, it } from "vitest";
import { addHours, hoursBetween, median, parseRepoId } from "./domain.js";

describe("hoursBetween", () => {
  it("measures wall-clock hours between two instants", () => {
    expect(hoursBetween("2026-08-15T00:00:00.000Z", "2026-08-15T06:30:00.000Z")).toBeCloseTo(6.5);
  });

  it("clamps to zero when reversed (durations can't be negative)", () => {
    expect(hoursBetween("2026-08-15T06:00:00.000Z", "2026-08-15T00:00:00.000Z")).toBe(0);
  });
});

describe("addHours", () => {
  it("adds hours to an instant", () => {
    expect(addHours("2026-08-15T00:00:00.000Z", 24)).toBe("2026-08-16T00:00:00.000Z");
  });
});

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it("averages the two middles for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });
});

describe("parseRepoId", () => {
  it("splits and normalizes owner/name and rejects URLs", () => {
    expect(parseRepoId("acme/widgets")).toEqual({ owner: "acme", repo: "widgets" });
    expect(parseRepoId("ACME/Widgets")).toEqual({ owner: "acme", repo: "widgets" });
    expect(() => parseRepoId("https://github.com/acme/widgets")).toThrow();
    expect(() => parseRepoId("acme")).toThrow();
  });
});
