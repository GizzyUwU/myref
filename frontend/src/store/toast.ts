import { createSignal } from "solid-js";

export type ToastTone = "info" | "success" | "error";

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

export function toast(message: string, tone: ToastTone = "info"): void {
  const id = nextId++;
  setToasts((current) => [...current, { id, message, tone }]);
  setTimeout(() => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, 4200);
}

export { toasts };
