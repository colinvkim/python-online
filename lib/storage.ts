const STORAGE_KEY = "python-canvas.code";
const TEMPLATE_KEY = "python-canvas.template";

export function readStoredCode() {
  if (typeof window === "undefined") {
    return null;
  }

  const code = window.localStorage.getItem(STORAGE_KEY);
  const templateId = window.localStorage.getItem(TEMPLATE_KEY);

  if (!code) {
    return null;
  }

  return { code, templateId };
}

export function persistCode(code: string, templateId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, code);

  if (templateId) {
    window.localStorage.setItem(TEMPLATE_KEY, templateId);
  } else {
    window.localStorage.removeItem(TEMPLATE_KEY);
  }
}

export function clearStoredCode() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(TEMPLATE_KEY);
}
