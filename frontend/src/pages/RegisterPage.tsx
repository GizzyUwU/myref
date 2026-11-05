import { A, Navigate, useNavigate } from "@solidjs/router";
import { createResource, createSignal, Show } from "solid-js";
import { api, ApiError } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { Field } from "../components/Field";
import { auth } from "../store/auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const [config] = createResource(async () => {
    try {
      return await api.authConfig();
    } catch {
      return { registrationEnabled: true };
    }
  });
  const registrationEnabled = () => config()?.registrationEnabled ?? true;
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError("");

    if (password().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password() !== confirm()) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      await auth.register({
        username: username(),
        password: password(),
      });
      navigate("/app");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not create account.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={!auth.user()} fallback={<Navigate href="/app" />}>
      <AuthLayout
        title="Create your account"
        subtitle="Free referencing with thousands of citation styles."
      >
        <Show
          when={registrationEnabled()}
          fallback={
            <p class="form-error">
              Registration is disabled. Please contact your administrator for
              an account.
            </p>
          }
        >
        <form onSubmit={submit} class="auth-form">
          <Field
            label="Username"
            hint="3–30 characters. Letters, numbers and underscores only."
          >
            <input
              value={username()}
              onInput={(event) => setUsername(event.currentTarget.value)}
              placeholder="yourname"
              autocomplete="username"
              autofocus
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]+"
            />
          </Field>

          <Field label="Password" hint="At least 8 characters.">
            <input
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              placeholder="Create a password"
              autocomplete="new-password"
              required
              minLength={8}
            />
          </Field>

          <Field label="Confirm password">
            <input
              type="password"
              value={confirm()}
              onInput={(event) => setConfirm(event.currentTarget.value)}
              placeholder="Repeat your password"
              autocomplete="new-password"
              required
            />
          </Field>

          <Show when={error()}>
            <p class="form-error">{error()}</p>
          </Show>

          <button type="submit" class="btn btn-primary btn-block" disabled={busy()}>
            {busy() ? "Creating account..." : "Create account"}
          </button>
        </form>
        </Show>

        <p class="auth-switch">
          Already have an account? <A href="/login">Sign in</A>
        </p>
      </AuthLayout>
    </Show>
  );
}
