// CSP podglądu prototypu (paczka 22): piaskownica bez allow-same-origin, bez sieci i bez wysyłania formularzy
export const PREVIEW_CSP = [
  "sandbox allow-scripts allow-modals allow-popups allow-forms",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob: https:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");
