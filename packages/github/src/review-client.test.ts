import { describe, expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { octokitReviewClient } from "./actuator.js";

/** Just enough of octokit for findComment: issue comments plus the GraphQL viewer. */
function fakeOctokit(viewer: string, comments: Array<{ id: number; login: string; body: string }>): Octokit {
  return {
    rest: { issues: { listComments: () => undefined } },
    paginate: async () => comments.map((c) => ({ id: c.id, body: c.body, user: { login: c.login } })),
    graphql: async () => ({ viewer: { login: viewer } }),
  } as unknown as Octokit;
}

const MARKER = "<!-- pullup:decision -->";
const at = { owner: "o", repo: "r", issue_number: 1, marker: MARKER };

describe("octokitReviewClient.findComment", () => {
  it("only finds comments written by this credential, never one where someone pasted the marker", async () => {
    const client = octokitReviewClient(
      fakeOctokit("pullup-ci[bot]", [
        { id: 1, login: "pullup-ci[bot]", body: `${MARKER} old` },
        { id: 2, login: "pullup-ci[bot]", body: `${MARKER} newer` },
        { id: 3, login: "someone", body: `quoting ${MARKER}` },
      ]),
    );
    expect(await client.findComment(at)).toBe(2);
  });

  it("returns null when only other people's comments carry the marker", async () => {
    const client = octokitReviewClient(fakeOctokit("pullup-ci[bot]", [{ id: 3, login: "jaytoday", body: `${MARKER} from a token run` }]));
    expect(await client.findComment(at)).toBeNull();
  });
});
