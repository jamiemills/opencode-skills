format: csm-deep-research/1

# Salesforce Headless 360 Research Finding

## TL;DR

Salesforce Headless 360 is best understood as a broad architectural/platform construct that exposes Salesforce data, business capabilities, commerce services, agent actions, and governance through APIs and other machine-facing interfaces rather than requiring a Salesforce screen. Salesforce says it is not a new product, while its public entitlement and packaging boundaries remain unclear.[R1][R2][R3]

It matters because clients can put Salesforce-powered capabilities into custom websites, mobile apps, portals, messaging channels, agents, and other tools while reusing backend logic. The strongest benefits are flexibility, channel reach, and reuse; the main trade-off is that clients assume more frontend, integration, security, testing, and lifecycle responsibility.[R4][R5]

## Executive Summary

The defensible model is:

```text
Salesforce data and business capabilities
        -> APIs / MCP where available / CLI / agent actions
        -> custom storefronts, apps, portals, agents, Slack, commerce channels
        -> client experience, with Salesforce governance intended to remain authoritative
```

Salesforce describes Headless 360 as making capabilities available to “any agent, any IDE, and any surface,” not as replacing Lightning Experience.[R1][R2] The architecture combines existing Salesforce products and services, including Data 360, Agentforce, Customer 360 applications, Commerce, Slack, APIs, and development tooling. In commerce, Salesforce documents established headless APIs, composable storefronts, React/PWA Kit, Managed Runtime, and multiple channel patterns.[R4][R6]

The evidence supports a real and useful platform direction, but not every broad claim in the umbrella. Salesforce’s public materials do not establish a single Headless 360 commercial boundary, universal availability across products or regions, a complete independently verifiable MCP catalog, lower total cost for typical clients, or independently verified ROI. A client should evaluate it as a contract-dependent, multi-product architecture rather than buy it as an abstract promise.[R5][R7][R8]

## Key Findings

1. **Supported:** Headless 360 is Salesforce’s architectural approach for exposing Salesforce capabilities through machine-facing interfaces and delivering them beyond the standard browser UI; it is not presented as a replacement for Lightning Experience.[R1][R2]
2. **Supported:** The core technical pattern is decoupling the experience layer from Salesforce data, business logic, workflows, and permissions, using APIs and, for documented capabilities, MCP, CLI, agent actions, or rendering layers.[R1][R3][R9]
3. **Partially-supported:** Data 360, Agentforce, and MuleSoft Agent Fabric can provide context, reasoning/action execution, and cross-agent orchestration respectively, but the exact runtime protocol, identity propagation, transaction semantics, and feature parity are not fully public.[R3][R9][R10]
4. **Supported:** Headless Commerce and composable storefront capabilities are established use cases, including custom storefronts, portals, kiosks, marketplaces, social channels, and mobile experiences.[R4][R6]
5. **Partially-supported:** Clients can benefit from faster frontend iteration, channel reach, and developer freedom, but these benefits depend on engineering maturity, integration scope, data quality, and operating model.[R4][R5][R11]
6. **Supported:** Headless architecture shifts responsibility to the client for frontend code, API orchestration, authentication, versioning, testing, monitoring, third-party integrations, and coordinated releases.[R5][R12]
7. **Partially-supported:** Salesforce states that identity, permissions, sharing, governance, and auditability carry through headless access, but public materials do not prove identical enforcement across every product, external client, custom frontend, MCP path, or integration.[R3][R9]
8. **Unverifiable:** Public evidence does not establish a comprehensive cross-product Headless 360 price or entitlement model, lower total cost of ownership, broad Headless 360 adoption, or independently validated client ROI.[R5][R7][R8]

## Detail Sections

**What it is.** Headless 360 is a platform-wide Salesforce positioning: backend data, workflows, business logic, permissions, and governance are made callable by agents, applications, IDEs, and other surfaces. Salesforce explicitly says it is “not a new product” and frames it as an architectural shift.[R1] The term overlaps with, but is broader than, Salesforce Headless Commerce. Salesforce’s own commerce material describes a decoupled storefront connected to commerce services through APIs; its broader platform pages place Commerce alongside Agentforce, Data 360, Customer 360, Slack, infrastructure, and integrations.[R4][R13]

The practical interpretation is therefore “Salesforce capabilities as governed services,” not “one new Salesforce application.” Salesforce now also describes current platform offerings and trials under the Headless 360 name, but the exact cross-product boundary remains uncertain because public pricing and entitlement pages still describe the underlying products separately.[R5][R7]

**Why it matters.** Traditional enterprise applications assume the user enters the vendor’s UI. Headless architecture reverses that dependency: the business capability can appear where work already happens. A sales or service process may be surfaced in a custom app, Slack, a portal, a mobile experience, an agent, or a commerce channel without rebuilding the underlying Salesforce data model and automation for each surface.[R1][R2][R4]

This is strategically important in the agentic era. Agents need callable, governed capabilities rather than screenshots or manual browser navigation. Salesforce is positioning itself as a system of execution and context as well as a system of record. That positioning is a Salesforce strategic claim; the architectural direction is supported, but the claim that it will become the central enterprise execution layer is not independently established.[R1][R3][R8]

**How the architecture fits together.** The main layers can be represented as:

```text
Data 360: unified, harmonized, federated context
       |
Business capabilities: APIs, Flow, Apex, workflows, commerce services
       |
Agents and orchestration: Agentforce, MCP clients/servers where supported,
                           MuleSoft Agent Fabric, external agents
       |
Experience delivery: HXL where available, custom React/web/mobile heads,
                     Slack, portals, commerce channels, partner surfaces
       |
Governance: identity, authorization, sharing, field security, policy,
            monitoring, audit, testing, and compliance controls
```

Data 360 is intended to connect, harmonize, resolve identities, calculate insights, segment, and activate data; zero-copy integrations can leave data in external systems such as Snowflake, Databricks, BigQuery, or AWS.[R9] Agentforce supplies agent planning, trusted context retrieval, actions, guardrails, monitoring, and escalation. Salesforce describes MuleSoft Agent Fabric as adding an agent registry, broker, governance, and visualization across Agentforce and third-party agents using protocols such as MCP and A2A.[R10]

**APIs, MCP, CLI, and agent actions.** APIs remain the general integration foundation. Salesforce presents MCP as a standardized way for compatible agents to discover and call resources, tools, and prompts, while the CLI supports browser-independent development, metadata, deployment, and automation.[R1][R3] Agentforce can also use existing Flows, Apex, prompt templates, APIs, Data 360, Slack, and MuleSoft capabilities as actions.[R9]

The evidence requires precision about MCP. Salesforce publicly advertises 60+ MCP tools and a Headless 360 MCP Server, and its Data 360 MCP material progressed from an early self-hosted preview to a later generally available Data 360 MCP announcement.[R3][R9] Salesforce’s August announcement labels the Headless 360 MCP Server open beta and the Data 360 MCP Server generally available, subject to product, region, and customer-agreement qualifications.[R3] Public sources still do not provide a complete independently verifiable catalog, endpoint inventory, protocol contract, or proof that every capability marketed under Headless 360 is MCP-enabled. MCP should not be confused with commerce protocols such as ACP or UCP, which address agentic commerce and checkout rather than general tool interoperability.[R14]

**Experience layer and headless commerce.** Salesforce describes the Headless Experience Layer as separating business logic, data, permissions, and intent from the screen, then translating the result into native experiences for surfaces such as web, mobile, Slack, Teams, ChatGPT, or other clients.[R3] Salesforce’s August announcement labels HXL open beta; its exact wire protocol, component schema, lifecycle, and production guarantees are not sufficiently specified publicly, so the conceptual role and announced beta status are better supported than the implementation detail.[R3]

Commerce is the most concrete headless example. Salesforce documents headless APIs for social media, kiosks, B2B buyer portals, marketplaces, custom storefronts, and embedded experiences. Composable Storefront uses React, PWA Kit, server-side rendering, Managed Runtime, hybrid deployment, and progressive migration patterns.[R4][R6] Salesforce has announced GA and beta statuses for specific commerce and agent capabilities, but availability varies by product, region, edition, and customer agreement.[R7]

**Security and governance.** Salesforce markets the advantage that external access does not require discarding its existing trust model. Salesforce states that supported headless experiences inherit identity, permissions, sharing rules, field-level security, compliance controls, and auditability; hosted MCP materials describe OAuth-based authenticated access and governed interoperability.[R3][R9] These are Salesforce product claims, not independent proof of identical enforcement across every cloud and integration.

That claim should be tested at the implementation boundary. A Salesforce-managed service may enforce platform authorization while a client-built frontend, third-party script, external MCP server, integration, or agent still introduces its own secrets, scopes, privacy, consent, fraud, content-security-policy, and supply-chain risks. The PWA Kit documentation explicitly leaves configuration responsibilities such as secrets, trusted script domains, and CSP with the implementation.[R12] Headless improves centralization of business controls; it does not make the whole distributed system automatically secure.

**Benefits to clients.** The client benefits are conditional rather than automatic:

- **Channel reach:** expose Salesforce-backed workflows in custom web/mobile apps, portals, kiosks, messaging, commerce, and partner experiences.[R4][R6]
- **Developer flexibility:** use custom frontends and industry-standard frameworks such as React instead of forcing every experience into a Salesforce-managed template.[R6]
- **Reuse:** Salesforce presents data access, workflows, validation, and business actions as reusable capabilities across channels; realized reduction in duplicated logic depends on implementation architecture.[R1][R3]
- **Faster iteration:** decoupled frontend changes can be deployed without changing the backend, and hybrid approaches can reduce migration blast radius; realized improvement depends on implementation architecture and operating capability.[R4][R6]
- **Agent enablement:** make governed business capabilities discoverable and callable by agents, while retaining human escalation and platform controls.[R3][R9]
- **Operational context:** connect customer, commerce, service, and analytical context so agents and applications can act with more complete information.[R9]

Salesforce customer stories report outcomes such as YETI building a customized experience in 4.5 weeks with a reported 63% year-over-year mobile-conversion increase, and Sonos reporting ecommerce growth, case deflection, and faster call resolution.[R11] These are useful examples of possible value, but they are vendor-published, selected cases without independent controls or complete cost and attribution data.

**Costs, risks, and best fit.** Headless is not automatically simpler or cheaper. Salesforce says it is generally best suited to large, digitally mature development teams; independent architecture analysis identifies additional API orchestration, authentication, versioning, frontend/backend coordination, testing, debugging, and maintenance.[R4][R5] The client may also need CMS, search, personalization, payments, tax, inventory, fulfillment, identity, observability, and release-management capabilities outside Salesforce.

Salesforce’s public commerce pricing is largely contact-based and varies by edition, sites, price books, Data 360 credits, order management, support, and other entitlements. Some Headless 360 capabilities may be included in platform offerings or trials, but public materials do not provide a comprehensive cross-product entitlement model or independently defensible three-year TCO.[R5][R7] The best fit is a client with meaningful multi-channel complexity, an existing Salesforce investment, strong product and engineering capability, and measurable outcomes that justify operating a distributed architecture. A managed storefront is likely safer where the client mainly needs a conventional experience and lacks the team to own the headless surface.

## Recommendation

Treat Headless 360 as a potentially powerful Salesforce architecture, not as a single product whose benefits arrive automatically. It is a strong candidate when a client needs multiple differentiated channels, reusable Salesforce business capabilities, custom frontend control, agent integration, or rapid experience experimentation and can operate the resulting API-driven system.[R1][R4][R5]

Before purchase or implementation, require Salesforce and the implementation partner to document: exact product entitlements and region, GA/beta status, API and MCP coverage, limits and versioning, identity and authorization flows, data residency and retention, SLA boundaries, frontend and integration responsibilities, migration/rollback design, and three-year total cost. Validate a measurable pilot against conversion, release time, service productivity, latency, defect rate, and operating cost.

**Confidence:** High that Salesforce provides genuine headless/composable capabilities and is pursuing a broader Headless 360 architecture. Medium for the exact cross-product runtime behavior, commercial packaging, and client ROI. The cost of being wrong is a large custom-platform program that increases operational burden without improving business outcomes.

## Unverified Claims

- **Unverified:** Headless 360 has one consistent SKU, license, or contractual product boundary across Salesforce clouds.
- **Unverified:** Every Salesforce capability is currently available through every claimed interface, region, edition, or customer agreement. Salesforce’s current announcement specifically labels Headless 360 MCP Server open beta, Data 360 MCP Server GA, Salesforce Multi-framework GA, HXL open beta, Agent Skills generally available, and Headless Commerce GA, with product-specific exceptions.[R3]
- **Unverified:** Salesforce publicly advertises 60+ MCP tools and a Headless 360 MCP Server, but a complete independently verifiable catalog, uniform endpoint, protocol, authentication, and capability coverage is not established.[R3]
- **Partially verified:** HXL is announced as open beta; its exact rendering schema, event model, client SDK, versioning guarantees, and production readiness across surfaces remain unverified.[R3]
- **Unverified:** Headless 360 lowers total cost of ownership for a typical client; public pricing and implementation costs are not sufficient to prove this.
- **Unverified:** Salesforce-reported performance, conversion, revenue, uptime, and customer-story metrics generalize to ordinary implementations or are independently audited.[R5][R7][R11]
- **Unverified:** Authorization, auditability, data retention, and zero-data-retention behavior are identical across Salesforce APIs, MCP servers, Agentforce, external agents, custom frontends, and third-party integrations.[R3][R9]
- **Unverified:** Broad market adoption of Headless 360 specifically; Salesforce publishes platform and customer-story evidence, not a Headless 360 penetration denominator.[R8]
- **Unverified:** Agent transaction atomicity, retries, idempotency, rollback, compensation, timeout, and human-approval semantics.[R9]

## References

[R1] Salesforce, “Discover the Headless Solution,” Trailhead, and “Entering a New Era of Salesforce Development with Headless 360,” https://trailhead.salesforce.com/content/learn/modules/salesforce-headless-360-quick-look/discover-the-headless-solution and https://www.salesforce.com/blog/headless-salesforce-development/ — retrieved 2026-08-24.

[R2] Salesforce, “Discover What Headless Means,” Trailhead, https://trailhead.salesforce.com/content/learn/modules/salesforce-headless-360-quick-look/get-to-know-salesforce-headless-360 — retrieved 2026-08-24.

[R3] Salesforce, “Salesforce Turns Enterprise Applications into Enterprise Capabilities,” “Headless Experience Layer,” “Salesforce Agent Skills & Plugins,” and hosted MCP documentation, https://www.salesforce.com/news/stories/expanding-headless-360-enterprise-capabilities/, https://www.salesforce.com/headless/agentic-experience-layer/, https://www.salesforce.com/headless/agent-skills-plugins/, and https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html — retrieved 2026-08-24. The hosted MCP documentation was partially inaccessible in this retrieval environment and is treated with reduced confidence where applicable.

[R4] Salesforce, “Headless Commerce Solutions” and “Composable Commerce Platform,” https://www.salesforce.com/commerce/headless/ and https://www.salesforce.com/commerce/composable/ — retrieved 2026-08-24.

[R5] TechTarget, “An overview of headless architecture design,” https://www.techtarget.com/it-infrastructure/tip/An-overview-of-headless-architecture-design — retrieved 2026-08-24.

[R6] Salesforce Commerce Cloud, PWA Kit repository and Salesforce commerce documentation, https://github.com/SalesforceCommerceCloud/pwa-kit and https://developer.salesforce.com/docs/commerce/pwa-kit-managed-runtime/guide — retrieved 2026-08-24.

[R7] Salesforce, “B2C Commerce Pricing,” “B2B Commerce Pricing,” and “Salesforce Turns Enterprise Applications into Enterprise Capabilities,” https://www.salesforce.com/commerce/b2c-ecommerce/pricing/, https://www.salesforce.com/commerce/b2b-ecommerce/pricing/, and https://www.salesforce.com/news/stories/expanding-headless-360-enterprise-capabilities/ — retrieved 2026-08-24.

[R8] Salesforce, “Salesforce Headless 360,” platform materials, and customer stories, https://www.salesforce.com/headless/ and https://www.salesforce.com/customer-stories/ — retrieved 2026-08-24.

[R9] Salesforce, “Data 360,” “Introducing the Data 360 MCP Server,” “Agentforce,” “Agentforce MCP Support,” and “Agentforce: How It Works,” https://www.salesforce.com/data/, https://www.salesforce.com/blog/introducing-the-data-360-mcp-server-your-unified-data-ready-for-any-agent/, https://www.salesforce.com/agentforce/, https://www.salesforce.com/agentforce/mcp-support/, and https://www.salesforce.com/agentforce/how-it-works/ — retrieved 2026-08-24.

[R10] Salesforce, “MuleSoft Agent Fabric,” https://www.salesforce.com/news/stories/mulesoft-agent-fabric-announcement/ and https://www.salesforce.com/mulesoft/agent-fabric/ — retrieved 2026-08-24.

[R11] Salesforce, YETI and Sonos customer stories, https://www.salesforce.com/customer-stories/yeti-online-shopper-experience/ and https://www.salesforce.com/resources/customer-stories/sonos-connected-experiences-build-customer-relationships/ — retrieved 2026-08-24.

[R12] Salesforce Commerce Cloud, PWA Kit security and lifecycle materials, https://github.com/SalesforceCommerceCloud/pwa-kit/blob/develop/STATEMENTS.md and https://github.com/SalesforceCommerceCloud/pwa-kit — retrieved 2026-08-24.

[R13] Salesforce, “Salesforce Headless 360,” https://www.salesforce.com/headless/ — retrieved 2026-08-24.

[R14] Salesforce, “Agentic Commerce Protocol” and “Universal Commerce Protocol” announcements, https://www.salesforce.com/news/press-releases/2025/10/14/stripe-openai-agentic-commerce-protocol-announcement/ and https://www.salesforce.com/news/stories/google-universal-commerce-protocol-support-announcement/ — retrieved 2026-08-24.

## Process Appendix

**Triage.** Tier: DEEP. Source mode: web-only. Rationale: the question is open-ended and spans architecture, product definition, availability, client value, security, cost, and risks. Research tracks: (1) official definition and scope, (2) technical architecture, (3) rollout and availability, (4) client benefits and trade-offs, and (5) adversarial public-claims review.

**Research reports.** Five independent web-only tracks returned evidence packs. Official sources established Salesforce positioning, architecture components, commerce capabilities, and stated availability. The technical track identified unresolved protocol and transaction details. The rollout track found product-specific GA/beta language and packaging uncertainty. The client-value track separated vendor customer stories from independent architecture risks. The adversarial track challenged “one product,” “any frontend,” “lower TCO,” uniform governance, broad adoption, and generalized performance claims.

**Challenge verdicts.** The adversarial evidence upheld the core claim that Salesforce has genuine headless/composable capabilities. It refined “Headless 360” as an architectural/platform construct with current platform and trial language but unclear cross-product entitlements; refined “any frontend” to API-level freedom with supported/reference implementation constraints; updated Data 360 MCP to announced GA and HXL to announced open beta; downgraded lower-TCO and performance claims to vendor assertions; and moved complete MCP coverage and uniform security behavior to Unverified Claims.

**Judge assessment.** Factual accuracy: pass, with product-boundary and availability caveats. Citation accuracy: pass for the cited source families; reduced confidence is disclosed for partially inaccessible developer documentation. Completeness: pass; all required sections are present and unresolved claims are listed. Clarity: pass; the finding answers what it is, why it matters, how it works, benefits, costs, and client fit.

**Remediation log.** The synthesis explicitly distinguishes Salesforce claims from independent evidence; describes Headless 360 as an architectural/platform construct rather than asserting no product or trial exists; records current MCP, HXL, Multi-framework, Skills, and Commerce availability labels; separates MCP from ACP/UCP; qualifies customer metrics; and adds implementation, pricing, security, lifecycle, and entitlement caveats. No material claim requiring retraction remained after challenge.

**Control journal.**

[2026-08-24T00:00:00Z] INTAKE -> TRIAGE :: cycle 0 :: trigger: research request received; protected baseline captured with clean `git status --short`; no declared run artifacts; temp scratch was not needed.
- [2026-08-24T00:00:00Z] TRIAGE complete :: cycle 0
- [2026-08-24T00:00:00Z] TRIAGE -> RESEARCH :: cycle 0 :: trigger: DEEP web-only strategy selected.
- [2026-08-24T00:00:00Z] RESEARCH complete :: cycle 0
- [2026-08-24T00:00:00Z] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: five independent evidence packs returned.
- [2026-08-24T00:00:00Z] SYNTHESIZE complete :: cycle 0
- [2026-08-24T00:00:00Z] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft claims mapped to retrieved sources.
- [2026-08-24T00:00:00Z] CHALLENGE complete :: cycle 0
- [2026-08-24T00:00:00Z] CHALLENGE -> JUDGE :: cycle 0 :: trigger: adversarial review returned downgrades and no unrecoverable contradiction.
- [2026-08-24T00:00:00Z] JUDGE complete :: cycle 0
- [2026-08-24T00:00:00Z] JUDGE -> REMEDIATE :: cycle 0 :: trigger: clarify product boundary, MCP scope, cost evidence, and governance caveats.
- [2026-08-24T00:00:00Z] REMEDIATE complete :: cycle 0
- [2026-08-24T00:00:00Z] REMEDIATE -> VERIFY :: cycle 0 :: trigger: all challenge resolutions recorded in finding.
- [2026-08-24T00:00:00Z] VERIFY complete :: cycle 0 :: trigger: claim scope, citations, required headings, redaction, and protected-state diff checked; only this research document differs from the clean baseline.
- [2026-08-24T00:00:00Z] VERIFY -> SAVED :: cycle 0 :: trigger: all DEEP-tier gates passed with residual availability and commercial unknowns disclosed above.
