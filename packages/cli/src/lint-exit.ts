/**
 * Exit code for `pullup lint`: 1 when a rule fails, 2 when no rule failed but some
 * file part could not be checked (the model was unreachable or errored), else 0.
 * A pre-push check must not pass just because the model was down. `--no-fail`
 * (fail = false) always exits 0.
 */
export function lintExitCode(result: { failures: readonly unknown[]; failed: number }, fail: boolean): number {
  if (!fail) return 0;
  if (result.failures.length > 0) return 1;
  return result.failed > 0 ? 2 : 0;
}
