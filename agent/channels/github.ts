// PullUp's GitHub channel: dispatch a turn when a PR is opened/updated or the
// bot is mentioned. In dev with no GITHUB_* credentials the channel stays
// present but webhooks are inert — `eve info` still lists it.
//
// turnPolicy is stamped on the export: webhook bursts must not cancel a
// committed analysis turn (githubChannel() has no turnPolicy option as of eve 0.65; the runtime reads it off the export).

import { githubChannel } from "eve/channels/github";

export default {
  ...githubChannel({
    onPullRequest(ctx, pullRequest) {
      if (
        pullRequest.action === "opened" ||
        pullRequest.action === "synchronize" ||
        pullRequest.action === "review_requested" ||
        pullRequest.action === "ready_for_review"
      ) {
        return {
          auth: {
            attributes: { login: ctx.sender.login },
            authenticator: "github",
            issuer: "github",
            principalId: `github:${ctx.sender.login}`,
            principalType: "user",
          },
        };
      }
      return null;
    },
    onComment(ctx) {
      // Any @mention of the bot on a PR/issue timeline or inline review.
      return {
        auth: {
          attributes: { login: ctx.sender.login },
          authenticator: "github",
          issuer: "github",
          principalId: `github:${ctx.sender.login}`,
          principalType: "user",
        },
      };
    },
  }),
  turnPolicy: "queue",
};
