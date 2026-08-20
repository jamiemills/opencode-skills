// Shared neutral-voice matcher (T010 / F-037).
//
// BANNED_VOICE + stripNonProse + findVoiceHits were copy-pasted across
// test/voice-gate.test.mjs, test/expansion-voice-gate.test.mjs, and
// test/expansion-render-registration.test.mjs. This helper is the single
// shared copy every voice gate imports; the vocabulary is pinned in one
// equality test in test/voice-gate.test.mjs so additions receive deliberate
// review. This file is a helper, not a .test.mjs, so importing it never
// registers another suite's tests.

export const BANNED_VOICE = Object.freeze([
  'should',
  'must',
  'ought',
  'shall',
  'poor',
  'good',
  'bad',
  'weak',
  'strong',
  'better',
  'worse',
  'best',
  'worst',
  'recommended',
  'recommendation',
  'ideally',
  'unfortunately',
  'concern',
  'concerning',
  'problem',
  'anti-pattern',
  'smell',
  'suboptimal',
  'inadequate',
  'insufficient',
  'contradiction',
  'contradictions',
  'inconsistent',
  'inconsistency',
  'conflict',
  'conflicts',
  'lacking',
]);

const BANNED_PATTERN = new RegExp(
  `\\b(?:${BANNED_VOICE.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

function mask(value) {
  return value.replace(/[^\n]/g, ' ');
}

// Repository-originated code, URLs, paths, and identifiers are masked (line
// numbers preserved) while all remaining authored prose is checked.
export function stripNonProse(markdown) {
  return markdown
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm, mask)
    .replace(/(`+)[^\n]*?\1/g, mask)
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi, mask)
    .replace(/^[ \t]*\|([^|]*)\|(.*)\|[ \t]*$/gm, (row, firstCell, valueCells, offset, source) => {
      const nextLine = source.slice(offset + row.length).match(/^\r?\n([^\r\n]*)/)?.[1] || '';
      const separator = /^[ \t]*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/.test(nextLine);
      if (separator) return row;
      return `|${firstCell}|${mask(valueCells)}|`;
    })
    .replace(/(?:~\/|\.{0,2}\/|\/)(?:[^\s`<>|()[\]{}]+\/)*[^\s`<>|()[\]{}]*/g, mask)
    .replace(/(?:[\w@+.-]+\/)+[\w@+,=~.-]+/g, mask)
    .replace(/(?<![\w@.-])[\w@+-]*[\w@+-]\.[A-Za-z0-9][\w.-]*/g, mask);
}

export function findVoiceHits(markdown) {
  const prose = stripNonProse(markdown);
  const hits = [];
  for (const [index, line] of prose.split('\n').entries()) {
    BANNED_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(BANNED_PATTERN)) {
      hits.push({ term: match[0].toLowerCase(), line: index + 1, text: line.trim() });
    }
  }
  return hits;
}
