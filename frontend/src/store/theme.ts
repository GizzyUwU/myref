import { createSignal } from "solid-js";

export const themes = ["light", "dracula", "macchiato", "mocha"] as const;

export type Theme = (typeof themes)[number];

export const themeLabels: Record<Theme, string> = {
  light: "Light",
  dracula: "Dracula",
  macchiato: "Catppuccin Macchiato",
  mocha: "Catppuccin Mocha",
};

const storageKey = "myref-theme";

function isTheme(value: string | null): value is Theme {
  return value === "dracula" || value === "macchiato" || value === "mocha";
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(storageKey);
  return isTheme(saved) ? saved : "light";
}

const [theme, setThemeSignal] = createSignal<Theme>(initialTheme());

function applyTheme(next: Theme): void {
  if (next === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = next;
  }
}

applyTheme(theme());

export function setTheme(next: Theme): void {
  setThemeSignal(next);
  localStorage.setItem(storageKey, next);
  applyTheme(next);
}

export const themeStore = {
  theme,
  setTheme,
};
