const identityPrivacyHook = (value) => value;

export function safeScalar(value, privacyHook = identityPrivacyHook) {
  return String(privacyHook(value) ?? '');
}

export function createRenderContext({ privacyHook = identityPrivacyHook } = {}) {
  if (typeof privacyHook !== 'function') {
    throw new TypeError('privacyHook must be a function');
  }
  return Object.freeze({
    escapeField(value, opts = {}) {
      let scalar = safeScalar(value, privacyHook);
      scalar = scalar.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`');
      if (!opts.inTable) scalar = scalar.replace(/^([-#+>])/gm, '\\$1');
      return scalar;
    },
  });
}

export const DEFAULT_RENDER_CONTEXT = createRenderContext();

export function finalizeMarkdown(parts) {
  return parts.join('\n').replace(/\r\n?/g, '\n');
}
