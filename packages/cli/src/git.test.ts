import { describe, expect, it } from "vitest";
import { repoIdFromRemote } from "./git.js";

describe("repoIdFromRemote", () => {
  it("reads owner/repo from ssh and https remotes", () => {
    expect(repoIdFromRemote("git@github.com:acme/widgets.git\n")).toBe("acme/widgets");
    expect(repoIdFromRemote("https://github.com/acme/widgets")).toBe("acme/widgets");
    expect(repoIdFromRemote("https://github.com/acme/widgets.git/")).toBe("acme/widgets");
    expect(repoIdFromRemote("https://gitlab.com/acme/widgets")).toBeNull();
  });
});
