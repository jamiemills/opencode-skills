const identityPrivacyHook = (value) => value;

// F-024: repo-controlled fields can never inject report lines. Every field
// rendered through escapeField has its newlines neutralized.
const NEWLINE_RE = /\r\n?|\n/g;

// F-024: the HTML-significant subset of the markdown token set (`<>[]()*_~!`).
// Escaped when a render context opts in (`markdownSafe`), which the
// repo-controlled free-text fields use so `<img onerror=…>` / `<script>` shapes
// cannot be smuggled into the report. The remaining formatting tokens
// (`[]()*_~!`) are a single flag flip once the R5-owned exact-render tests
// that pin those characters are relaxed.
const MARKDOWN_HTML_TOKENS = /[<>]/g;

export function safeScalar(value, privacyHook = identityPrivacyHook) {
  return String(privacyHook(value) ?? "");
}

export function createRenderContext({
  privacyHook = identityPrivacyHook,
  markdownSafe = false,
} = {}) {
  if (typeof privacyHook !== "function") {
    throw new TypeError("privacyHook must be a function");
  }
  return Object.freeze({
    escapeField(value, opts = {}) {
      let scalar = safeScalar(value, privacyHook);
      scalar = scalar.replace(NEWLINE_RE, " ");
      scalar = scalar.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "\\`");
      if (markdownSafe || opts.markdownSafe) scalar = scalar.replace(MARKDOWN_HTML_TOKENS, "\\$&");
      if (!opts.inTable) scalar = scalar.replace(/^([-#+>])/gm, "\\$1");
      return scalar;
    },
  });
}

export const DEFAULT_RENDER_CONTEXT = createRenderContext();

export function finalizeMarkdown(parts) {
  return parts.join("\n").replace(/\r\n?/g, "\n");
}
