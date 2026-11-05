import { Navigate, Route, Router } from "@solidjs/router";
import { lazy, onMount, Show } from "solid-js";
import { Logo } from "./components/Brand";
import { auth } from "./store/auth";

// Route-split: each page becomes its own chunk so first paint only
// downloads the shell + router + the page actually visited.
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const ProjectPage = lazy(() =>
  import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

function Splash() {
  return (
    <div class="splash">
      <div class="splash-inner">
        <Logo />
        <span class="spinner" />
      </div>
    </div>
  );
}

function HomeRedirect() {
  return <Navigate href={auth.user() ? "/app" : "/login"} />;
}

export default function App() {
  onMount(() => {
    void auth.loadMe();
  });

  return (
    <Show when={auth.ready()} fallback={<Splash />}>
      <Router>
        <Route path="/" component={HomeRedirect} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/app" component={DashboardPage} />
        <Route path="/app/settings" component={SettingsPage} />
        <Route path="/app/projects/:id" component={ProjectPage} />
        <Route path="*" component={NotFoundPage} />
      </Router>
    </Show>
  );
}
