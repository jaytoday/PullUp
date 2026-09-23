import { createContext, createResource, useContext, type ParentComponent, type Resource } from "solid-js";
import { api, type AppConfig, type RepoSummary } from "@/lib/api";

interface AppContextValue {
  config: Resource<AppConfig>;
  repos: Resource<RepoSummary[]>;
  refetchRepos: () => void;
}

const AppContext = createContext<AppContextValue>();

/** Config + repo list, shared by the shell and every page. */
export const AppProvider: ParentComponent = (props) => {
  const [config] = createResource(api.config);
  const [repos, { refetch }] = createResource(api.repos);
  return (
    <AppContext.Provider value={{ config, repos, refetchRepos: () => void refetch() }}>
      {props.children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
