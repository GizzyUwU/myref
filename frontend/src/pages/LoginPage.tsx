import { A, Navigate, useNavigate } from "@solidjs/router";
import { createResource, createSignal, Show } from "solid-js";
import { api, ApiError } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field } from "../components/Field";
import { auth } from "../store/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [config] = createResource(async () => {
    try {
      return await api.authConfig();
    } catch {
      return { registrationEnabled: true };
    }
  });
  const [identifier, setIdentifier] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await auth.login(identifier(), password());
      navigate("/app");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not sign in.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={!auth.user()} fallback={<Navigate href="/app" />}>
      <AuthLayout
        title="Welcome back"
        subtitle="Sign in to pick up your references where you left off."
      >
        <form onSubmit={submit} class="auth-form">
          <Field label="Email or username">
            <input
              value={identifier()}
              onInput={(event) => setIdentifier(event.currentTarget.value)}
              placeholder="you@example.com"
              autocomplete="username"
              autofocus
              required
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              placeholder="Your password"
              autocomplete="current-password"
              required
            />
          </Field>

          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>

          <button type="submit" class="btn btn-primary btn-block" disabled={busy()}>
            {busy() ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <Show when={config()?.registrationEnabled ?? true}>
          <p class="auth-switch">
            New to MyRef? <A href="/register">Create an account</A>
          </p>
        </Show>
      </AuthLayout>
    </Show>
  );
}
