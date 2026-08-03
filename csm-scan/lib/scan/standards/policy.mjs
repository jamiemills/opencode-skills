const ENTRY_KEYS = Object.freeze([
  'disposition',
  'edition',
  'editionKey',
  'id',
  'officialUri',
  'publicationDate',
  'publisher',
  'title',
]);

export const STANDARDS_DISPOSITIONS = Object.freeze([
  'authored_mapping',
  'metadata_only',
]);

const ID_PATTERN = /^std:[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EDITION_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/;
const FLOATING_EDITION_PATTERN = /(?:^|[^a-z])(?:current|latest|draft|unspecified|next|nightly|rolling|snapshot|provisional|preview|dev|head|trunk)(?:$|[^a-z])/i;
const EDITION_QUALIFIERS = Object.freeze({
  rpof: /\bRevised Points of Focus\b/i,
  errata01: /\bErrata 01\b/i,
  rec: /\b(?:REC|Recommendation)\b/i,
});

function fail(message) {
  throw new TypeError(`Invalid standards metadata: ${message}`);
}

function requireAsciiString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail(`${field} must be a non-empty trimmed string`);
  }
  if (/[^\x20-\x7e]/.test(value)) fail(`${field} must contain ASCII text only`);
  return value;
}

function validateOfficialUri(value) {
  requireAsciiString(value, 'officialUri');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('officialUri must be an absolute URI');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    fail('officialUri must be an HTTPS URI without credentials or a fragment');
  }
  return value;
}

function validatePublicationDate(value) {
  if (value === null) return value;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    fail('publicationDate must be null, YYYY-MM, or YYYY-MM-DD');
  }
  if (value.length === 10) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
      fail('publicationDate must be a calendar date');
    }
  }
  return value;
}

function validateEdition(id, editionKey, edition) {
  requireAsciiString(editionKey, 'editionKey');
  if (!EDITION_KEY_PATTERN.test(editionKey)) fail('editionKey must be stable and versioned');
  if (id.slice(id.lastIndexOf(':') + 1) !== editionKey) {
    fail('editionKey must match the edition suffix of id');
  }

  requireAsciiString(edition, 'edition');
  if (FLOATING_EDITION_PATTERN.test(editionKey) || FLOATING_EDITION_PATTERN.test(edition)) {
    fail('edition must not use a floating marker');
  }

  const versionComponents = editionKey.match(/\d+(?:\.\d+)*/g) ?? [];
  if (versionComponents.length === 0) fail('editionKey must contain a version component');
  const editionComponents = new Set(edition.match(/\d+(?:\.\d+)*/g) ?? []);
  if (versionComponents.some((component) => !editionComponents.has(component))) {
    fail('edition must contain every editionKey version component');
  }

  const qualifiers = editionKey.split(/[._-]/).filter((component) => /[a-z]/.test(component));
  for (const qualifier of qualifiers) {
    const marker = EDITION_QUALIFIERS[qualifier];
    if (!marker) fail(`editionKey contains unknown qualifier: ${qualifier}`);
    if (!marker.test(edition)) fail(`edition must contain the ${qualifier} qualifier marker`);
  }
}

export function reuseDisposition(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    fail('reuse options must be an object');
  }
  const keys = Object.keys(options).sort();
  const allowed = ['authoredMapping', 'reuseProven'];
  if (keys.some((key) => !allowed.includes(key))) fail('reuse options contain an unknown field');

  const { authoredMapping = false, reuseProven = false } = options;
  if (typeof authoredMapping !== 'boolean' || typeof reuseProven !== 'boolean') {
    fail('reuse options must be boolean');
  }
  return authoredMapping && reuseProven ? 'authored_mapping' : 'metadata_only';
}

export function validateStandardEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('entry must be an object');
  }

  const keys = Object.keys(entry).sort();
  if (keys.length !== ENTRY_KEYS.length || keys.some((key, index) => key !== ENTRY_KEYS[index])) {
    fail('entry fields do not match the standards metadata schema');
  }

  const id = requireAsciiString(entry.id, 'id');
  if (!ID_PATTERN.test(id)) fail('id must be stable and versioned');
  const publisher = requireAsciiString(entry.publisher, 'publisher');
  const title = requireAsciiString(entry.title, 'title');
  const edition = requireAsciiString(entry.edition, 'edition');
  const editionKey = requireAsciiString(entry.editionKey, 'editionKey');
  validateEdition(id, editionKey, edition);
  const publicationDate = validatePublicationDate(entry.publicationDate);
  const officialUri = validateOfficialUri(entry.officialUri);
  if (entry.disposition !== 'metadata_only') fail('registry disposition must be metadata_only');

  return Object.freeze({
    id,
    publisher,
    title,
    editionKey,
    edition,
    publicationDate,
    officialUri,
    disposition: 'metadata_only',
  });
}

export function validateStandardsRegistry(entries) {
  if (!Array.isArray(entries)) fail('registry must be an array');

  const validated = entries.map(validateStandardEntry);
  const ids = new Set();
  const uris = new Set();
  for (const entry of validated) {
    if (ids.has(entry.id)) fail(`duplicate id: ${entry.id}`);
    if (uris.has(entry.officialUri)) fail(`duplicate officialUri: ${entry.officialUri}`);
    ids.add(entry.id);
    uris.add(entry.officialUri);
  }

  return Object.freeze(validated.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
