"use strict";

import { createHash } from "node:crypto";
import { digest } from "../schema-runtime/index.mjs";
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_ELEMENTS,
  HTML_CSP,
  HTML_MEDIA_TYPE,
  HTML_RENDERER,
  HTML_RENDERER_POLICY,
  HTML_VOID_ELEMENTS,
  validateUrlPolicy,
} from "./security-policy.mjs";

const ELEMENTS = new Set(ALLOWED_ELEMENTS.map((tagName) => tagName.trim()));
const ATTRIBUTES = new Set(ALLOWED_ATTRIBUTES);
const VOID_ELEMENTS = new Set(HTML_VOID_ELEMENTS);
const HTML_RENDERER_DIGEST = digest({ renderer: HTML_RENDERER, policy: HTML_RENDERER_POLICY });

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll("`", "&#96;");
}

function element(tag, attrs = {}, children = []) {
  if (!ELEMENTS.has(tag)) throw new TypeError(`HTML element is not allowlisted: ${tag}`);
  const safeAttrs = Object.entries(attrs)
    .filter(([name, value]) => ATTRIBUTES.has(name) && value !== undefined && value !== null)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  const opening = `<${tag}${safeAttrs}>`;
  if (VOID_ELEMENTS.has(tag)) return opening;
  return `${opening}${children.join("")}</${tag}>`;
}

function text(value) {
  return escapeText(value);
}

function safeUrl(value, policy) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowedSchemes = new Set(policy.schemes.map((scheme) => `${scheme}:`));
  if (
    policy.mode !== "allowlist" ||
    !allowedSchemes.has(url.protocol) ||
    !url.hostname ||
    url.hostname.startsWith(".") ||
    url.hostname.endsWith(".") ||
    url.username ||
    url.password ||
    url.hostname.includes("..")
  )
    return null;
  return url.href;
}

function safeId(prefix, section, sectionIndex, item, itemIndex) {
  const value = `${section}:${sectionIndex}:${item}:${itemIndex}`;
  const normalized = String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = normalized.slice(0, 48);
  const suffix =
    normalized.length > 48
      ? `-${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12)}`
      : "";
  return `${prefix}-${slug || "item"}${suffix}`;
}

function createIdRegistry() {
  const ids = [];
  return {
    generate(prefix, section, sectionIndex, item, itemIndex) {
      const id = safeId(prefix, section, sectionIndex, item, itemIndex);
      ids.push(id);
      return id;
    },
    assertUnique() {
      if (new Set(ids).size !== ids.length)
        throw new TypeError("generated HTML IDs must be unique");
    },
  };
}

function displayValue(item) {
  if (item.redacted) return "[REDACTED]";
  if (item.kind === "boolean") return item.value ? "true" : "false";
  if (item.kind === "number") return String(item.value);
  if (item.kind === "date" || item.kind === "text" || item.kind === "code") return item.value;
  return undefined;
}

function renderJsonValue(value) {
  if (value === null) return text("null");
  if (["string", "number", "boolean"].includes(typeof value)) return text(value);
  if (Array.isArray(value)) {
    return element(
      "ul",
      {},
      value.map((item) => element("li", {}, [renderJsonValue(item)])),
    );
  }
  if (typeof value === "object") {
    return element(
      "dl",
      {},
      Object.keys(value)
        .toSorted()
        .flatMap((key) => [
          element("dt", {}, [text(key)]),
          element("dd", {}, [renderJsonValue(value[key])]),
        ]),
    );
  }
  return text("[UNSUPPORTED VALUE]");
}

function renderItem(item, section, sectionIndex, itemIndex, profile, idRegistry) {
  const labelId = idRegistry.generate("csm-label", section.id, sectionIndex, item.path, itemIndex);
  const profileField = profile.fields.find(
    (field) =>
      field.path === item.path &&
      field.kind === item.kind &&
      (field.section ?? profile.sections[0]?.id) === section.id,
  );
  if (item.redacted && profileField?.redaction === "omit") return [];
  const label = element("dt", { id: labelId }, [text(item.label)]);
  const common = { "aria-label": item.accessibleLabel };
  if (item.kind === "link" && item.presentation === "text-and-url") {
    const url = safeUrl(item.url, profile.urlPolicy);
    if (!url) throw new TypeError(`unsafe URL in render model at ${item.path}`);
    return [
      label,
      element("dd", common, [element("a", { href: url, rel: "noreferrer" }, [text(item.value)])]),
    ];
  }
  if (item.kind === "link") return [label, element("dd", common, [text(item.value)])];
  if (item.kind === "list") return [label, element("dd", common, [renderJsonValue(item.value)])];
  if (item.kind === "table") {
    const rows = item.value;
    const header = rows[0];
    const columns = Array.isArray(header)
      ? header.map((_, column) => String(column + 1))
      : Object.keys(header ?? {}).toSorted();
    const bodyRows = rows.map((row) =>
      element(
        "tr",
        {},
        columns.map((column, columnIndex) =>
          element("td", {}, [renderJsonValue(Array.isArray(row) ? row[columnIndex] : row[column])]),
        ),
      ),
    );
    return [
      label,
      element("dd", common, [
        element("table", { "aria-labelledby": labelId }, [
          element("thead", {}, [
            element(
              "tr",
              {},
              columns.map((column) => element("th", { scope: "col" }, [text(column)])),
            ),
          ]),
          element("tbody", {}, bodyRows),
        ]),
      ]),
    ];
  }
  if (item.kind === "code") {
    return [
      label,
      element("dd", common, [
        element("pre", {}, [
          element("code", { class: `language-${item.language}` }, [text(item.value)]),
        ]),
      ]),
    ];
  }
  const value = displayValue(item);
  return [
    label,
    element("dd", { ...common, ...(item.redacted ? { role: "status" } : {}) }, [
      text(value ?? "[UNSUPPORTED VALUE]"),
    ]),
  ];
}

function validateModel(model, profile, projection, schemaRegistry) {
  if (!model || typeof model !== "object" || Array.isArray(model))
    throw new TypeError("HTML renderer accepts only a validated render-model object");
  if (model.schema !== "csm-render-model/1")
    throw new TypeError("HTML renderer accepts only csm-render-model/1");
  if (!schemaRegistry || typeof schemaRegistry.validate !== "function")
    throw new TypeError("schema registry is required to validate the render model");
  const result = schemaRegistry.validate("csm-render-model/1", model);
  if (!result.valid) throw new TypeError("render model failed schema validation");
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    throw new TypeError("validated render profile is required");
  const profileResult = schemaRegistry.validate("csm-render-profile/1", profile);
  if (!profileResult.valid) throw new TypeError("render profile failed schema validation");
  if (
    profile.profile.id !== model.profile.id ||
    profile.profile.revision !== model.profile.revision ||
    profile.sourceSchema.id !== model.source.id ||
    profile.sourceSchema.revision !== model.source.revision
  )
    throw new TypeError("render profile does not match render model");
  if (!projection || typeof projection !== "object" || Array.isArray(projection))
    throw new TypeError("projection metadata is required");
  const required = [
    "projectionId",
    "source",
    "sourceRunId",
    "sourceOwner",
    "rendererDigest",
    "profileDigest",
    "generatedAt",
  ];
  const allowed = new Set([...required, "renderer", "profile"]);
  if (Object.keys(projection).some((key) => !allowed.has(key)))
    throw new TypeError("projection metadata contains unsupported fields");
  for (const key of required)
    if (!Object.hasOwn(projection, key)) throw new TypeError(`projection.${key} is required`);
  if (
    !projection.renderer ||
    projection.renderer.id !== HTML_RENDERER.id ||
    projection.renderer.revision !== HTML_RENDERER.revision ||
    Object.keys(projection.renderer).length !== 2
  )
    throw new TypeError("projection renderer does not match HTML renderer");
  if (
    !projection.profile ||
    projection.profile.id !== profile.profile.id ||
    projection.profile.revision !== profile.profile.revision ||
    Object.keys(projection.profile).length !== 2
  )
    throw new TypeError("projection profile does not match render profile");
  if (
    !projection.source ||
    Array.isArray(projection.source) ||
    projection.source.schema?.id !== model.source.id ||
    projection.source.schema?.revision !== model.source.revision ||
    Object.keys(projection.source).length !== 3 ||
    !projection.source.schema ||
    Object.keys(projection.source.schema).length !== 2
  )
    throw new TypeError("projection source schema does not match render model");
  if (!/^art-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.source.artifactId))
    throw new TypeError("invalid source artifact ID");
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.sourceRunId))
    throw new TypeError("invalid source run ID");
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(projection.sourceOwner))
    throw new TypeError("invalid source owner");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.source?.digest))
    throw new TypeError("invalid source artifact digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.rendererDigest))
    throw new TypeError("invalid renderer digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.profileDigest))
    throw new TypeError("invalid profile digest");
  if (projection.profileDigest !== digest(profile))
    throw new TypeError("projection profile digest does not match validated render profile");
  if (projection.rendererDigest !== HTML_RENDERER_DIGEST)
    throw new TypeError("projection renderer digest does not match HTML renderer policy");
  if (!/^proj-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.projectionId))
    throw new TypeError("invalid projection ID");
  if (
    typeof projection.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(projection.generatedAt) ||
    Number.isNaN(Date.parse(projection.generatedAt))
  )
    throw new TypeError("invalid generated timestamp");
  validateUrlPolicy(profile.urlPolicy);
}

export function renderHtml({
  model,
  schemaRegistry,
  profile,
  projection,
  generatedAt = "1970-01-01T00:00:00.000Z",
} = {}) {
  validateModel(model, profile, projection, schemaRegistry);
  const resolvedGeneratedAt = projection.generatedAt ?? generatedAt;
  const sourceDigest = projection.source.digest;
  const profileDigest = digest(profile);
  const metadata = {
    source: { schema: model.schema, ref: model.source, digest: sourceDigest },
    profile: { ...projection.profile, digest: profileDigest },
    renderer: {
      ...HTML_RENDERER,
      digest: HTML_RENDERER_DIGEST,
    },
    mediaType: HTML_MEDIA_TYPE,
    status: "untrusted-presentation",
  };
  const idRegistry = createIdRegistry();
  const sections = model.sections.map((section, sectionIndex) =>
    (() => {
      const headingId = idRegistry.generate("csm-heading", section.id, sectionIndex, "heading", 0);
      return element(
        "section",
        {
          id: idRegistry.generate("csm-section", section.id, sectionIndex, "section", 0),
          "aria-labelledby": headingId,
        },
        [
          element("h2", { id: headingId }, [text(section.label)]),
          element(
            "dl",
            {},
            section.items.flatMap((item, itemIndex) =>
              renderItem(item, section, sectionIndex, itemIndex, profile, idRegistry),
            ),
          ),
        ],
      );
    })(),
  );
  idRegistry.assertUnique();
  const html = `<!doctype html>${element("html", { lang: "en" }, [
    element("head", {}, [
      element("meta", { charset: "utf-8" }),
      element("meta", { "http-equiv": "Content-Security-Policy", content: HTML_CSP }),
      element("meta", { name: "csm-csp", content: HTML_CSP }),
      element("meta", { name: "csm-source-artifact", content: projection.source.artifactId }),
      element("meta", {
        name: "csm-source-schema",
        content: `${projection.source.schema.id}/${projection.source.schema.revision}`,
      }),
      element("meta", { name: "csm-source-digest", content: sourceDigest }),
      element("meta", { name: "csm-output-media-type", content: HTML_MEDIA_TYPE }),
      element("meta", { name: "csm-output-status", content: "untrusted-presentation" }),
      element("meta", {
        name: "csm-profile",
        content: `${projection.profile.id}/${projection.profile.revision}`,
      }),
      element("meta", {
        name: "csm-renderer",
        content: `${HTML_RENDERER.id}/${HTML_RENDERER.revision}`,
      }),
      element("title", {}, [text("Rendered projection")]),
    ]),
    element("body", {}, [
      element("main", { id: "csm-rendered-projection" }, [
        element("h1", {}, [text("Rendered projection")]),
        element("p", { role: "status" }, [
          text("Untrusted presentation derived from validated JSON."),
        ]),
        ...sections,
      ]),
    ]),
  ])}`;
  const outputDigest = `sha256:${createHash("sha256").update(Buffer.from(html, "utf8")).digest("hex")}`;
  const descriptor = {
    schema: "csm-projection/1",
    projectionId: projection.projectionId,
    source: { ...projection.source, digest: sourceDigest },
    sourceRunId: projection.sourceRunId,
    sourceOwner: projection.sourceOwner,
    mediaType: HTML_MEDIA_TYPE,
    renderer: projection.renderer,
    profile: projection.profile,
    rendererDigest: projection.rendererDigest,
    profileDigest,
    generatedAt: resolvedGeneratedAt,
    outputDigest,
    status: "untrusted-presentation",
    approval: {
      status: "pending",
      binding: {
        source: { ...projection.source, digest: sourceDigest },
        sourceRunId: projection.sourceRunId,
        sourceOwner: projection.sourceOwner,
        renderer: projection.renderer,
        rendererDigest: projection.rendererDigest,
        profile: projection.profile,
        profileDigest,
        outputDigest,
      },
    },
  };
  const projectionResult = schemaRegistry.validate("csm-projection/1", descriptor);
  if (!projectionResult.valid)
    throw new TypeError(
      `projection descriptor failed schema validation: ${projectionResult.errors[0]?.message ?? "unknown error"}`,
    );
  return {
    html,
    bytes: Buffer.from(html, "utf8"),
    digest: outputDigest,
    outputDigest,
    projection: descriptor,
    metadata: { ...metadata, generatedAt: resolvedGeneratedAt, outputDigest },
  };
}

export { HTML_RENDERER_DIGEST, escapeAttribute, escapeText, safeUrl };
