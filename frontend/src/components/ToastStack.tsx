import { For } from "solid-js";
import { toasts } from "../store/toast";

export function ToastStack() {
  return (
    <div class="toast-stack" aria-live="polite">
      <For each={toasts()}>
        {(item) => <div class={`toast ${item.tone}`}>{item.message}</div>}
      </For>
    </div>
  );
}
