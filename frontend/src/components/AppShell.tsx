import { A, useNavigate } from "@solidjs/router";
import type { JSX } from "solid-js";
import { auth, userInitials } from "../store/auth";
import { toast } from "../store/toast";
import { Logo } from "./Brand";
import { ToastStack } from "./ToastStack";

export function AppShell(props: { children: JSX.Element }) {
  const navigate = useNavigate();

  async function signOut() {
    await auth.logout();
    toast("Signed out.", "info");
    navigate("/login");
  }

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <A href="/app" class="topbar-brand">
            <Logo compact />
          </A>

          <div class="topbar-right">
            <span class="style-chip">CSL · citeproc-js</span>
            <A href="/app" class="nav-link">
              Projects
            </A>
            <A href="/app/settings" class="nav-link">
              Settings
            </A>
            <div class="user-chip">
              <span class="avatar">
                {userInitials(auth.user()?.username ?? "MR")}
              </span>
              <span class="user-name">{auth.user()?.username ?? "Account"}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main class="page">{props.children}</main>
      <ToastStack />
    </div>
  );
}
