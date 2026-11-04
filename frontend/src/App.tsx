import { Navigate, Route, Router } from "@solidjs/router";
import { onMount, Show } from "solid-js";
import { Logo } from "./components/Brand";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { auth } from "./store/auth";

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
