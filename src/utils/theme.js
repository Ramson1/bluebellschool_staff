// Theme (dark/light) helpers.
// The active theme is stored as a data-theme="light|dark" attribute on <html>
// plus localStorage ("jmis-theme"). When no attribute is set (e.g. JS disabled)
// the CSS media-query rules fall back to the OS preference automatically.
//
// Same key/mechanism as the admin portal (bluebellschool/src/utils/theme.js) so the
// dark/light choice is consistent across the Bluebell apps.

export const THEME_KEY = "jmis-theme";

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "light" ? t : null;
  } catch {
    return null;
  }
}

export function getSystemTheme() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

// Current effective theme: explicit choice first, OS preference as fallback.
export function getEffectiveTheme() {
  try {
    return (
      document.documentElement.getAttribute("data-theme") ||
      getStoredTheme() ||
      getSystemTheme()
    );
  } catch {
    return "light";
  }
}

export function applyTheme(theme) {
  try {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* SSR or storage unavailable — ignore */
  }
}

export function toggleTheme() {
  const next = getEffectiveTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
