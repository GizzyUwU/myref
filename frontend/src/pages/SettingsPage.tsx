import { A, Navigate, useNavigate } from "@solidjs/router";
import { createEffect, createSignal, Show } from "solid-js";
import { api, ApiError } from "../api";
import { AppShell } from "../components/AppShell";
import { auth } from "../store/auth";
import { toast } from "../store/toast";

export function SettingsPage() {
  const navigate = useNavigate();
  const [username, setUsername] = createSignal(auth.user()?.username ?? "");
  const [renameLoading, setRenameLoading] = createSignal(false);
  const [renameError, setRenameError] = createSignal("");

  createEffect(() => {
    const current = auth.user()?.username;
    if (current && !username()) setUsername(current);
  });

  async function renameAccount(event: Event) {
    event.preventDefault();
    setRenameError("");
    const next = username().trim();
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(next)) {
      setRenameError(
        "Username must be 3-30 characters using only letters, numbers or underscores.",
      );
      return;
    }
    if (next === auth.user()?.username) {
      setRenameError("That is already your username.");
      return;
    }
    setRenameLoading(true);
    try {
      const result = await api.updateUsername({ username: next });
      auth.setUser(result.user);
      toast("Username updated.", "success");
    } catch (caught) {
      setRenameError(
        caught instanceof ApiError ? caught.message : "Could not update username.",
      );
    } finally {
      setRenameLoading(false);
    }
  }

  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [changeLoading, setChangeLoading] = createSignal(false);
  const [changeError, setChangeError] = createSignal("");

  const [deletePassword, setDeletePassword] = createSignal("");
  const [deleteLoading, setDeleteLoading] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");

  async function changePassword(event: Event) {
    event.preventDefault();
    setChangeError("");

    if (newPassword() !== confirmPassword()) {
      setChangeError("New passwords do not match.");
      return;
    }
    if (newPassword().length < 8) {
      setChangeError("New password must be at least 8 characters.");
      return;
    }

    setChangeLoading(true);
    try {
      await api.changePassword({
        currentPassword: currentPassword(),
        newPassword: newPassword(),
      });
      toast("Password updated.", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (caught) {
      setChangeError(
        caught instanceof ApiError
          ? caught.message
          : "Could not change password.",
      );
    } finally {
      setChangeLoading(false);
    }
  }

  async function deleteAccount() {
    setDeleteError("");
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This cannot be undone and all your projects and references will be deleted.",
    );
    if (!confirmed) return;

    setDeleteLoading(true);
    try {
      await api.deleteAccount({ password: deletePassword() });
      auth.setUser(null);
      toast("Account deleted.", "info");
      navigate("/login", { replace: true });
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError
          ? caught.message
          : "Could not delete account.",
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <Show when={auth.user()} fallback={<Navigate href="/login" />}>
      <AppShell>
        <div class="page-header">
          <div>
            <A href="/app" class="back-link">
              ← Back to projects
            </A>
            <h1>Account settings</h1>
            <p class="subtle">Manage your profile, password and account.</p>
          </div>
        </div>

        <div class="settings-grid">
          <section class="panel">
            <header class="panel-header">
              <div>
                <h2>Profile</h2>
                <p class="panel-subtitle">Rename your account.</p>
              </div>
            </header>
            <form class="settings-form" onSubmit={renameAccount}>
              <label class="field">
                <span class="field-label">Username</span>
                <input
                  type="text"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                  minlength={3}
                  maxlength={30}
                  required
                />
              </label>
              <p class="subtle small">Signed in as {auth.user()?.email ?? ""}.</p>
              <Show when={renameError()}>
                <p class="form-error">{renameError()}</p>
              </Show>
              <button
                type="submit"
                class="btn btn-primary"
                disabled={renameLoading()}
              >
                {renameLoading() ? "Saving..." : "Save username"}
              </button>
            </form>
          </section>

          <section class="panel">
            <header class="panel-header">
              <div>
                <h2>Change password</h2>
                <p class="panel-subtitle">Update your account password.</p>
              </div>
            </header>
            <form class="settings-form" onSubmit={changePassword}>
              <label class="field">
                <span class="field-label">Current password</span>
                <input
                  type="password"
                  value={currentPassword()}
                  onInput={(e) => setCurrentPassword(e.currentTarget.value)}
                  required
                />
              </label>
              <label class="field">
                <span class="field-label">New password</span>
                <input
                  type="password"
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  minlength={8}
                  required
                />
              </label>
              <label class="field">
                <span class="field-label">Confirm new password</span>
                <input
                  type="password"
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  minlength={8}
                  required
                />
              </label>
              <Show when={changeError()}>
                <p class="form-error">{changeError()}</p>
              </Show>
              <button type="submit" class="btn btn-primary" disabled={changeLoading()}>
                {changeLoading() ? "Updating..." : "Change password"}
              </button>
            </form>
          </section>

          <section class="panel danger-panel">
            <header class="panel-header">
              <div>
                <h2>Delete account</h2>
                <p class="panel-subtitle">
                  Permanently delete your account and all data.
                </p>
              </div>
            </header>
            <div class="settings-form">
              <label class="field">
                <span class="field-label">Confirm with password</span>
                <input
                  type="password"
                  value={deletePassword()}
                  onInput={(e) => setDeletePassword(e.currentTarget.value)}
                  required
                />
              </label>
              <Show when={deleteError()}>
                <p class="form-error">{deleteError()}</p>
              </Show>
              <button
                type="button"
                class="btn btn-danger"
                disabled={deleteLoading() || !deletePassword()}
                onClick={deleteAccount}
              >
                {deleteLoading() ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </section>
        </div>
      </AppShell>
    </Show>
  );
}
