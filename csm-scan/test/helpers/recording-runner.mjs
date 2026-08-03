function snapshot(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Error) {
    const copy = new Error(value.message);
    seen.set(value, copy);
    copy.name = value.name;
    copy.stack = value.stack;
    if ('cause' in value) copy.cause = snapshot(value.cause, seen);
    for (const key of Reflect.ownKeys(value)) {
      if (!['name', 'message', 'stack', 'cause'].includes(key)) copy[key] = snapshot(value[key], seen);
    }
    return Object.freeze(copy);
  }
  if (typeof value.aborted === 'boolean' && 'reason' in value && typeof value.addEventListener === 'function') {
    return Object.freeze({ aborted: value.aborted, reason: snapshot(value.reason, seen) });
  }
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) copy[key] = snapshot(value[key], seen);
  return Object.freeze(copy);
}

function regexCanStart(mask, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(mask[cursor])) cursor--;
  if (cursor < 0 || /[({[,:;=!?&|+*%^~<>-]/.test(mask[cursor])) return true;
  const end = cursor + 1;
  while (cursor >= 0 && /[A-Za-z]/.test(mask[cursor])) cursor--;
  return /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(mask.slice(cursor + 1, end).join(''));
}

export function lexicalMask(source) {
  const mask = source.split('');
  const blank = (index) => { mask[index] = source[index] === '\n' ? '\n' : ' '; };

  function quoted(index, quote) {
    blank(index++);
    while (index < source.length) {
      const char = source[index];
      blank(index++);
      if (char === '\\' && index < source.length) blank(index++);
      else if (char === quote) break;
    }
    return index;
  }

  function regex(index) {
    blank(index++);
    let characterClass = false;
    while (index < source.length) {
      const char = source[index];
      blank(index++);
      if (char === '\\' && index < source.length) blank(index++);
      else if (char === '[') characterClass = true;
      else if (char === ']') characterClass = false;
      else if (char === '/' && !characterClass) break;
      else if (char === '\n') break;
    }
    while (/[A-Za-z]/.test(source[index] || '')) blank(index++);
    return index;
  }

  function template(index) {
    blank(index++);
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        blank(index++);
        if (index < source.length) blank(index++);
      } else if (char === '`') {
        blank(index++);
        return index;
      } else if (char === '$' && source[index + 1] === '{') {
        blank(index++);
        index = code(index + 1, '}');
      } else {
        blank(index++);
      }
    }
    return index;
  }

  function code(index, terminator = null) {
    let braceDepth = 0;
    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];
      if (terminator && char === terminator && braceDepth === 0) return index + 1;
      if (char === '{') {
        braceDepth++;
        index++;
      } else if (char === '}') {
        braceDepth--;
        index++;
      } else if (char === "'" || char === '"') index = quoted(index, char);
      else if (char === '`') index = template(index);
      else if (char === '/' && next === '/') {
        blank(index++);
        blank(index++);
        while (index < source.length && source[index] !== '\n') blank(index++);
      } else if (char === '/' && next === '*') {
        blank(index++);
        blank(index++);
        while (index < source.length) {
          const end = source[index] === '*' && source[index + 1] === '/';
          blank(index++);
          if (end) {
            blank(index++);
            break;
          }
        }
      } else if (char === '/' && regexCanStart(mask, index)) index = regex(index);
      else index++;
    }
    return index;
  }

  code(0);
  return mask.join('');
}

export function matchingBrace(mask, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < mask.length; index++) {
    if (mask[index] === '{') depth++;
    else if (mask[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

export function createRecordingRunner(outcomes = []) {
  const configured = typeof outcomes === 'function'
    ? outcomes
    : (Array.isArray(outcomes) ? outcomes : [outcomes]).map((outcome) => snapshot(outcome));
  const history = [];
  const calls = new Proxy(history, {
    set() { throw new TypeError('recording history is read-only'); },
    deleteProperty() { throw new TypeError('recording history is read-only'); },
    defineProperty() { throw new TypeError('recording history is read-only'); },
  });

  async function run(executable, argv = [], options = {}) {
    const call = snapshot({
      executable,
      argv,
      ...options,
    });
    history.push(call);

    const outcome = typeof configured === 'function'
      ? await configured(snapshot({ ...call }), history.length - 1)
      : configured[history.length - 1];
    if (outcome instanceof Error) throw outcome;
    return snapshot(outcome ?? { status: 0, stdout: '', stderr: '' });
  }

  return Object.freeze({ calls, run });
}
