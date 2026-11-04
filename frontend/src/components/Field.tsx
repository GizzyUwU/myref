import { Show, type JSX } from "solid-js";

export function Field(props: {
  label: string;
  hint?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <label class={`field ${props.class ?? ""}`}>
      <span class="field-label">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="field-hint">{props.hint}</span>
      </Show>
    </label>
  );
}
