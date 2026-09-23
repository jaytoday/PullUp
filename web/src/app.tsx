import { Route, Router } from "@solidjs/router";
import { lazy, type ParentComponent } from "solid-js";
import { AppProvider } from "@/components/layout/app-context";
import { RepoLayout } from "@/components/layout/repo-layout";
import { Shell } from "@/components/layout/shell";
import Home from "@/routes/home";
import Overview from "@/routes/overview";

const Pulls = lazy(() => import("@/routes/pulls"));
const Actions = lazy(() => import("@/routes/actions"));
const Calibration = lazy(() => import("@/routes/calibration"));
const Analytics = lazy(() => import("@/routes/analytics"));
const Settings = lazy(() => import("@/routes/settings"));

const Root: ParentComponent = (props) => (
  <AppProvider>
    <Shell>{props.children}</Shell>
  </AppProvider>
);

export function App() {
  return (
    <Router root={Root}>
      <Route path="/" component={Home} />
      <Route path="/settings" component={Settings} />
      <Route path="/r/:owner/:repo" component={RepoLayout}>
        <Route path="/" component={Overview} />
        <Route path="/pulls/:n?" component={Pulls} />
        <Route path="/actions" component={Actions} />
        <Route path="/calibration" component={Calibration} />
        <Route path="/analytics" component={Analytics} />
      </Route>
      <Route path="*" component={Home} />
    </Router>
  );
}
