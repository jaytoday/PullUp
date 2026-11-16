"use client";

import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Stat } from "@astryxdesign/lab";

/** PullUp's own counts: what the check said, from its records (synthetic runs included and counted). */
export function RunCounts({ c }: { c: { total: number; pass: number; fail: number; waiting: number; errors: number; synthetic: number } }) {
  return (
    <Grid columns={{ minWidth: 160 }} gap={3}>
      <Card padding={4}>
        <Stat label="Runs" value={String(c.total)} description={c.synthetic ? `${c.synthetic} synthetic` : "all real"} />
      </Card>
      <Card padding={4}>
        <Stat label="Passed" value={String(c.pass)} />
      </Card>
      <Card padding={4}>
        <Stat label="Failed" value={String(c.fail)} />
      </Card>
      <Card padding={4}>
        <Stat label="Waiting for a person" value={String(c.waiting)} description={c.errors ? `${c.errors} errors` : undefined} />
      </Card>
    </Grid>
  );
}
