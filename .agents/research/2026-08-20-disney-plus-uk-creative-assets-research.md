format: csm-deep-research/1
# Disney+ UK Creative Assets Research Finding

## TL;DR

The UK is served by Disney's official EMEA "Disney+ Video Commercial" spec (the operative creative-spec document for UK advertisers): linear video commercials in `.mov`/`.mp4`, 16:9, 15/20/30/60s, 1920x1080 preferred (720p accepted), Apple ProRes or H.264 High profile, 10-40 Mbps, 23.98-30 FPS CFR progressive, YUV, PCM/AAC 48kHz stereo, max 1.9 GB, VAST 2.0/3.0 from approved vendors, pre-roll and mid-roll only. Interactive/pause/shoppable formats announced for the US product are not verified as available in the UK. The deliverable JSON Schema (Section 5) encodes exactly the verified constraints, inline and self-contained.

## Executive Summary

The research question — "what creative assets are supported by Disney+ in the UK" — was classified STANDARD tier x web source mode, with three parallel researcher tracks: (T1) Disney+ UK ad tier and offered formats, (T2) technical creative asset specs, (T3) IAB/interoperability standards. 46 claims were retrieved from 16 sources on 2026-08-20, headed by Disney's own EMEA creative spec and advertising newsroom.

```text
Research question -> Triage (STANDARD x web, 3 tracks) -> Parallel researchers
   -> Synthesis -> Challenge -> Judge -> Verified finding + JSON Schema
```

The headline outcome: there IS an official, retrievable Disney document that enumerates the accepted creative assets for the UK market — the EMEA "Disney+ Video Commercial" spec (PDF, English edition, updated 2025-11-19), which governs the UK. It restricts creatives to pre-roll/mid-roll linear video commercials and states hard technical limits (format, duration, resolution, codec, bitrate, frame rate, color, audio, file weight, serving rules). The JSON Schema in Section 5 was built from those verified constraints. The strongest caveat: all interactive/shoppable/pause formats Disney has announced (Gateway Go, Pause Ads, Pause+, Ad Selector, KERV Sync/L-Bar/Impulse) are US-origin announcements; no official source confirms their availability on Disney+ in the UK, so they are documented as unverified rather than encoded into the schema's required surface.

## Key Findings

K1. **supported** — Disney+ UK has an ad-supported tier ("Standard with Ads") that launched 2023-11-01 at £4.99/month and is now part of a 15-market EMEA footprint; the UK tier is the placement surface for advertiser creative assets. [R1] [R2] [R3]

K2. **supported** — The operative official creative-spec document for UK advertisers is the EMEA "Disney+ Video Commercial" spec published by Disney Advertising (English PDF; hub page "Disney+ Video Commercial EMEA"); there is no separate UK-only spec and no EMEA "Advertising Inventory Guidelines" PDF (US/Canada/ANZ versions exist only). [R4] [R5]

K3. **supported** — The EMEA spec accepts only linear video commercials in pre-roll and mid-roll positions, with these technical constraints: `.mov` or `.mp4`; 15, 20, 30, or 60 seconds; 16:9 aspect ratio; 1920x1080 preferred, 1280x720 accepted; 10,000-40,000 Kbps; Apple ProRes or H.264 (High profile); 23.98/24/25/29.97/30 FPS native, constant frame rate, progressive scan; YUV color space (never "unknown"); audio PCM or AAC, min 192 Kbps, 48 kHz, 2-channel stereo, exactly 1 audio track matching video duration; max file weight 1.9 GB. [R5]

K4. **supported** — Serving constraints: VAST 2.0 and 3.0 from Disney+-approved vendors, 1x1 verification pixels; ads are non-skippable; VAST tags may not contain JavaScript or `<VASTAdTagURI>` wrappers; site-served creatives are accepted; VPAID is not supported. [R5]

K5. **supported** — Creative content rules: CTA buttons styled as clickable (e.g. "Learn More", "Buy Now") are not allowed; URLs, hashtags, QR codes and social handles are accepted for 18+ profiles only; keep the top-right 220x135 px of 1920x1080 clear; no leaders (slates/countdowns); letterboxing/pillarboxing case-by-case; up to 5 business days turnaround. [R5]

K6. **partially-supported** — UK/EMEA delivery is programmatic: campaigns run on the Disney Ad Server with 10+ DSPs (Amazon DSP, The Trade Desk, Google DV360) and DRAX in EMEA, with BARB (UK) measurement as the first SVOD to sign up. Partial: the corroborating "30 DSPs / DoubleVerify / IAS / Moat verification vendors" announcement is a US-market statement. [R6] [R7]

K7. **partially-supported** — The Disney+ product supports an expanded creative-length range (midrolls, :15s-:90s) and interactive formats (Gateway Go, Pause Ads, Pause+, Ad Selector, KERV Sync/L-Bar/Impulse, BrightLine/Innovid/KERV interactive) per official US announcements — but no retrieved source confirms these in the UK/EMEA, so they are unverified for the UK. [R8] [R9] [R10] [R11]

K8. **supported** — The IAB standards layer that defines creatives a Disney+ UK placement can carry: VAST 4.x current (VAST 2.0/3.0 still served), SIMID replacing VPAID for interactive in SSAI, Open Measurement SDK for CTV verification, and the IAB Tech Lab CTV Ad Portfolio (final 2026-07-22) which Disney publicly endorsed. [R12] [R13] [R14] [R15]

## Detail Sections

### 1. The UK ad tier — where creative assets are served (K1)

Disney+ launched its ad-supported plan "Standard with Ads" in the UK on 2023-11-01 at £4.99/month, alongside eight other European markets [R1] [R2]. The UK ad tier remains live: Disney's EMEA SVP for Advertising (UK & Ireland country manager) states the ad tier has expanded to 15 European markets since 2023 [R3]. This tier is the delivery surface for advertiser creatives; the R1/R2/R3 sources fix the market facts (UK launch date, price, footprint) but none enumerates creative assets — that job is the EMEA spec (Section 2).

### 2. The official EMEA creative spec — the schema's source (K2, K3, K4, K5)

The single authoritative document for "what creative assets Disney+ UK supports" is Disney Advertising's EMEA media kit hub page listing "Disney+ Video Commercial EMEA" with six language editions (English/Deutsch/Español/Français/Português/Türkçe) [R4], pointing to the English spec PDF [R5]. The PDF's stated scope: "This document outlines the specifications for video advertisements running in Pre-Roll and Mid-Roll positions on Disney+ for viewers in international regions" [R5].

```text
Disney+ Video Commercial (EMEA, English, updated 2025-11-19)
  scope: Pre-Roll + Mid-Roll only (UK = EMEA market)
  file: .mov | .mp4          duration: 15 | 20 | 30 | 60 s
  ratio: 16:9                res: 1920x1080 (pref) | 1280x720 (accepted)
  video bitrate: 10,000-40,000 Kbps
  codec: Apple ProRes | H.264 (Profile: High)
  fps: 23.98 | 24 | 25 | 29.97 | 30 (native, CFR, progressive, no pull-down)
  color: YUV (never unknown/None)
  audio: PCM | AAC, >=192 Kbps, 48 kHz, 2-ch stereo, exactly 1 track == video
  weight: <= 1.9 GB          serving: VAST 2.0/3.0, 1x1 pixels, approved vendors,
                                       site-served accepted, VPAID not supported
  rules: non-skippable, no JS, no wrappers, no clickable CTA, QR/URL 18+ only,
         clear 220x135 top-right, no leaders, letterboxing case-by-case,
         5 business days turnaround
```

Each constraint above is a verbatim quoted requirement of the PDF (see References R5). Notably absent from the spec: loudness targets (no EBU R128 number), HEVC/AV1/CMAF for creative delivery (advertisers supply ProRes/H.264 masters; Disney handles transcode), and any companion/banner/display asset spec — the EMEA media kit lists only the video-commercial spec [R4] [R5]. The K3/K4/K5 claims therefore describe the complete verified "accepted creative assets" surface for the UK.

### 3. Serving and interoperability standards (K4, K8)

The EMEA spec restricts ad serving to VAST 2.0/3.0 responses without JavaScript or wrapper tags; its availability table accepts site-served creatives on Desktop/Mobile/Apps/OTT and rejects VPAID [R5]. Ads are served overlaid with an "Ad" logo and countdown timer (hence the 220x135 top-right safety zone), and user privacy data restrictions may limit where third-party hosted and tracked creatives can serve — a GDPR-relevant constraint for UK/EU delivery [R5]. The IAB layer surrounding that: current VAST is 4.3 (2022-12), with a CTV Addendum (2024) adding higher-resolution-creative guidance and DSA/ACIF support [R12]; VPAID is deprecated in favor of SIMID (interactive) and Open Measurement (verification), which is what makes SSAI environments like a streaming app work [R13] [R14]. IAB Tech Lab's CTV Ad Portfolio (six CTV formats: Pause, Menu, Screensaver, In Scene, Squeezebacks, Overlays; final 2026-07-22) is the emerging non-linear portfolio, and Disney publicly endorsed that workstream — but its live deployment on Disney+ UK is not claimed by any retrieved source [R15]. IAB UK's own guidance pages (online ad portfolio explainer, digital-video best practice) exist but are archival (~2016-2018) and display-oriented, not Disney+ specs [R16] [R17].

### 4. Programmatic delivery in the UK (K6)

Disney states EMEA campaigns "will now run on the Disney Ad Server", integration "with over 10 of the most widely-used DSPs, including Amazon DSP, The Trade Desk and Google Display & Video 360", DRAX (Disney Real-Time Ad Exchange) on the EMEA platform, and BARB in the UK as the first SVOD participant [R6]. The US-market counterpart announcement adds the wider creative-length range (midrolls, :15s-:90s) and 30 DSPs with verification vendors (DoubleVerify, Moat, IAS, AdForm, DCM, Extreme Reach, Flashtalking, Innovid, Jivox, Sizmek) [R7]. Both documents are Disney's own newsroom; R6 is EMEA/UK-specific, R7 is US-origin — hence K6 is partially-supported.

### 5. The deliverable: JSON Schema for Disney+ UK creative assets

Built strictly from the verified constraints in Sections 2-4. "Inline schema" = a fully self-contained draft-07 document: every subschema is defined inline (`$defs` referenced locally by `$ref` within the same document), no external schemas, no remote URLs required for validation. Encoding policy: only verified constraints enter the schema; US-only/unverified formats are documented in `$comment` and the Unverified Claims section instead of being accepted.

Run artifact: the same schema is published as a standalone file at `.agents/research/artifacts/2026-08-20-disney-plus-uk-creative-assets-schema.json` (extracted verbatim from the block below; the block is retained inline for corpus readability).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://disney.creative-specs.example/schemas/disneyplus-uk-creative-asset.schema.json",
  "title": "Disney+ UK Creative Asset",
  "description": "Creative assets accepted by Disney+ Standard with Ads in the UK. Source: Disney Advertising 'Disney+ Video Commercial EMEA' spec (English PDF, updated 2025-11-19) and Disney Advertising EMEA newsroom statements, retrieved 2026-08-20. Only linear video commercials (pre-roll/mid-roll) are supported in the UK; interactive/pause/shoppable formats are unverified for the UK and intentionally not accepted.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "assetType",
    "fileFormat",
    "durationSeconds",
    "aspectRatio",
    "resolution",
    "video",
    "audio",
    "fileWeightGB",
    "placement",
    "serving"
  ],
  "$defs": {
    "video": {
      "type": "object",
      "title": "Video track",
      "description": "Exactly one video track is permitted and must match the audio duration.",
      "additionalProperties": false,
      "required": ["trackCount", "codec", "bitrateKbps", "frameRate", "frameRateMode", "scanType", "colorSpace"],
      "properties": {
        "trackCount": { "const": 1, "description": "Must have exactly 1 video track." },
        "codec": {
          "enum": ["Apple ProRes", "H.264"],
          "description": "Apple ProRes or H.264. When H.264, profile High is required."
        },
        "h264Profile": {
          "const": "High",
          "description": "Required only for H.264 files; the EMEA spec fixes profile to High."
        },
        "bitrateKbps": {
          "type": "integer",
          "minimum": 10000,
          "maximum": 40000,
          "description": "10,000-40,000 Kbps."
        },
        "frameRate": {
          "enum": [23.98, 24, 25, 29.97, 30],
          "type": "number",
          "description": "Native frame rate only; duplicate frames not allowed; remove any pull-down added for broadcast."
        },
        "frameRateMode": { "const": "CFR", "description": "Constant frame rate." },
        "scanType": { "const": "Progressive", "description": "Adaptive deinterlace with no frame blending." },
        "colorSpace": { "const": "YUV", "description": "Video color space cannot be 'unknown' or None." }
      }
    },
    "audio": {
      "type": "object",
      "title": "Audio track",
      "description": "Audio is required: exactly one track, 2-channel stereo, must match the video duration.",
      "additionalProperties": false,
      "required": ["trackCount", "codec", "bitrateKbpsMin", "sampleRateHz", "channels", "matchesVideoDuration"],
      "properties": {
        "trackCount": { "const": 1, "description": "Must have exactly 1 audio track." },
        "codec": { "enum": ["PCM", "AAC"], "description": "PCM or AAC." },
        "bitrateKbpsMin": { "const": 192, "description": "192 Kbps minimum." },
        "sampleRateHz": { "const": 48000, "description": "48 kHz." },
        "channels": { "const": 2, "description": "2-channel stereo mix." },
        "matchesVideoDuration": { "const": true, "description": "Audio must match video duration." }
      }
    },
    "serving": {
      "type": "object",
      "title": "Ad serving constraints",
      "additionalProperties": false,
      "required": ["vastVersions", "skippable", "javascriptAllowed", "wrapperTagsAllowed", "vpaid", "siteServed", "verificationPixels", "approvedVendorsOnly"],
      "properties": {
        "vastVersions": {
          "type": "array",
          "items": { "enum": ["2.0", "3.0"] },
          "minItems": 1,
          "uniqueItems": true,
          "description": "Disney+ accepts standard creative, VAST 2.0 & 3.0."
        },
        "skippable": { "const": false, "description": "Disney+ video ads are non-skippable." },
        "javascriptAllowed": { "const": false, "description": "VAST tags cannot contain JavaScript elements." },
        "wrapperTagsAllowed": { "const": false, "description": "VAST tags cannot contain <VASTAdTagURI> wrappers." },
        "vpaid": { "const": false, "description": "VPAID not supported." },
        "siteServed": { "const": true, "description": "Site-served creatives are accepted (availability table: Site-Served = Yes on Desktop/Mobile/Apps/OTT; the EMEA spec references a 'VAST & Site-served Video Spec' companion document)." },
        "verificationPixels": { "const": "1x1", "description": "1x1 verification pixels from Disney+ approved vendors." },
        "approvedVendorsOnly": { "const": true, "description": "VAST served from Disney+ approved vendors only." }
      }
    }
  },
  "properties": {
    "assetType": {
      "const": "video-commercial",
      "description": "The only creative asset type with an official Disney+ EMEA/UK spec."
    },
    "fileFormat": {
      "enum": [".mov", ".mp4"],
      "description": "QuickTime .mov or MPEG-4 .mp4."
    },
    "durationSeconds": {
      "enum": [15, 20, 30, 60],
      "description": "15, 20, 30, or 60 seconds."
    },
    "aspectRatio": {
      "const": "16:9",
      "description": "Required aspect ratio for the UK/EMEA market."
    },
    "resolution": {
      "enum": ["1920x1080", "1280x720"],
      "description": "1920x1080 preferred; 1280x720 accepted."
    },
    "video": { "$ref": "#/$defs/video" },
    "audio": { "$ref": "#/$defs/audio" },
    "fileWeightGB": {
      "type": "number",
      "maximum": 1.9,
      "description": "Maximum file weight 1.9 GB."
    },
    "placement": {
      "enum": ["pre-roll", "mid-roll"],
      "description": "Pre-roll and mid-roll positions only per the EMEA spec."
    },
    "serving": { "$ref": "#/$defs/serving" },
    "creativeRules": {
      "type": "object",
      "title": "Creative content rules",
      "additionalProperties": false,
      "required": ["clickableCTAStylingAllowed", "audienceLevel", "safetyZoneTopRightPx", "leadersAllowed", "letterboxing", "turnaroundBusinessDays"],
      "properties": {
        "clickableCTAStylingAllowed": { "const": false, "description": "CTA buttons that look clickable (e.g. 'Learn More', 'Buy Now') are not allowed." },
        "audienceLevel": { "enum": ["18+", "17-and-under"], "description": "URLs/hashtags/QR codes/social handles accepted for 18+ profiles only; not accepted for 17 & under." },
        "safetyZoneTopRightPx": { "const": "220x135", "description": "Keep the top-right 220x135 px of 1920x1080 clear; the player overlays an 'Ad' logo and countdown there." },
        "leadersAllowed": { "const": false, "description": "No leaders such as slates or countdowns." },
        "letterboxing": { "const": "case-by-case", "description": "Letterboxing/pillarboxing permitted on a case-by-case basis." },
        "turnaroundBusinessDays": { "const": 5, "description": "Up to 5 business days lead time from receipt of final assets." },
        "thirdPartyTrackingMayBeRestricted": { "const": true, "description": "User privacy data restrictions may limit where third-party hosted and tracked creatives can serve (GDPR-relevant in UK/EU)." }
      }
    }
  }
}
```

Usage note: the schema validates the *verified* UK surface only. An asset declaring `assetType: "pause-ad"` or `durationSeconds: 90` fails validation by design — those formats are US-product announcements, not UK-supported per any retrieved source (see K7, Unverified Claims). Validation example: a compliant asset is `{"assetType":"video-commercial","fileFormat":".mp4","durationSeconds":30,"aspectRatio":"16:9","resolution":"1920x1080","fileWeightGB":1.2,"placement":"mid-roll","video":{"trackCount":1,"codec":"H.264","h264Profile":"High","bitrateKbps":20000,"frameRate":25,"frameRateMode":"CFR","scanType":"Progressive","colorSpace":"YUV"},"audio":{"trackCount":1,"codec":"AAC","bitrateKbpsMin":192,"sampleRateHz":48000,"channels":2,"matchesVideoDuration":true},"serving":{"vastVersions":["3.0"],"skippable":false,"javascriptAllowed":false,"wrapperTagsAllowed":false,"vpaid":false,"siteServed":true,"verificationPixels":"1x1","approvedVendorsOnly":true},"creativeRules":{"clickableCTAStylingAllowed":false,"audienceLevel":"18+","safetyZoneTopRightPx":"220x135","leadersAllowed":false,"letterboxing":"case-by-case","turnaroundBusinessDays":5,"thirdPartyTrackingMayBeRestricted":true}}`.

## Recommendation

Use the Section 5 JSON Schema as the canonical validation contract for Disney+ UK creative assets. Confidence: **high** for the linear-video-commercial surface — every encoded constraint is quoted from Disney's own EMEA spec [R5], the operative document for the UK market. The schema is intentionally strict: it validates only what official sources verify for the UK (pre-roll/mid-roll linear video, 15/20/30/60s, 16:9, ProRes/H.264, VAST 2.0/3.0 serving). What would change the answer: an official Disney announcement of UK availability for interactive formats (Gateway Go, Pause Ads, Pause+, Ad Selector, KERV units) or a UK-specific inventory-guidelines PDF — both would expand the schema's `assetType`/`placement` enums. Cost of being wrong: including unverified interactive formats would accept assets Disney+ UK may reject; omitting them risks missing a format if Disney quietly enables it (mitigate by re-checking the EMEA media kit hub [R4] quarterly).

## Unverified Claims

U1. **Interactive/pause/shoppable formats on Disney+ UK** — unverified. Gateway Go (launched on Disney+ 2025-04), Pause Ads (2025-10), Pause+ (winter 2025), Ad Selector (early 2026), and KERV Sync/L-Bar/Impulse are official Disney announcements for the US product; no retrieved source confirms UK/EMEA availability [R9] [R10] [R11]. To verify: official Disney Advertising EMEA statement or UK media-kit listing of these formats.

U2. **"Disney+ Advertising Inventory Guidelines" for EMEA/UK** — unverified by absence. The official guidelines hub publishes US/Canada/ANZ versions only [R18]. To verify: re-check the hub for an EMEA edition or an equivalent UK spec.

U3. **Current UK price of Standard with Ads** — unverified. £4.99 was the 2023 launch price [R2]; no retrieved source documents 2024-2026 price changes. (Not schema-relevant.)

U4. **Ad-load UX facts for UK (~4 min ads/hour, movie ads before-start-only, no ads in Junior profiles, UK launch advertisers)** — unverified; sourced only from a fan-site article quoting Disney EMEA executives at the 2023 London event [R19], with no official press confirmation. (Not schema-relevant.)

U5. **Duration "15, 20, ..." from the 2023 EMEA PDF snippet** — superseded; the current PDF (2025-11-19) states 15/20/30/60s [R5]. The 2023 snippet was truncated in a search-engine excerpt [R20] and is not used in the schema.

U6. **EBU R128 loudness target for Disney+ UK creatives** — unverified. No loudness number appears in the EMEA spec; loudness normalization is general industry practice, not a confirmed Disney+ UK requirement.

U7. **Content-artwork interpretation** — the alternative reading of "creative assets supported by Disney+" as content artwork/title-card delivery specs (e.g. Disney D3/CMA delivery requirements) was not researched; this finding covers advertising creative assets, which is the reading consistent with Disney's published "creative spec" documents.

U8. **The approved-vendor list is unpublished** — the EMEA spec states VAST must come from "Disney+ approved vendors" and directs advertisers to "contact your Disney Advertising representative to confirm approved vendors" [R5]; the schema models it as a boolean precondition rather than an enumeration. To verify: obtain the approved-vendor list from a Disney Advertising representative.

U9. **"VAST & Site-served Video Spec" companion document** — the EMEA PDF references a "VAST & Site-served Video Spec" section that is not in the document itself [R5], so VAST-tag/asset-delivery rules beyond the quoted sentences are unverified. To verify: locate and retrieve that companion spec from Disney Advertising.

## References

- [R1] Disney UK press release — "Disney+ to launch an ad-supported subscription plan on November 1 in Europe" — https://press.disney.co.uk/news/disney+-to-launch-an-ad-supported-subscription-plan-on-november-1-in-europe — retrieved 2026-08-20
- [R2] The Walt Disney Company — "Disney to Launch Ad-Supported Subscription Offering in Several Countries Across Europe and in Canada on November 1" — https://thewaltdisneycompany.com/press-releases/disney-to-launch-ad-supported-subscription-offering-in-several-countries-across-europe-and-in-canada-on-november-1/ — retrieved 2026-08-20
- [R3] Disney Advertising press — "Where Fandom Meets Measurable Impact: The Evolution of Disney's Advertising Technology Ecosystem in EMEA" — https://press.disneyadvertising.com/where-fandom-meets-measurable-impact:-the-evolution-of-disneys-advertising-technology-ecosystem-in-emea — retrieved 2026-08-20
- [R4] Disney Advertising media kit — "Disney+ EMEA Media Kit" (hub listing Disney+ Video Commercial EMEA in 6 languages) — https://www.disneyadvertising.com/mediakit/disney-plus/disney-plus-international/disney-plus-emea-mediakit/ — retrieved 2026-08-20
- [R5] Disney Advertising — "Disney+ Video Commercial EMEA" spec (English PDF, updated 2025-11-19) — https://files.disneyadvertising.com/MediaKit/Disney-Plus/_International/disneyplus_video_emea_english.pdf — retrieved 2026-08-20
- [R6] Disney Advertising press — EMEA ad-tech evolution (Disney Ad Server, 10+ DSPs, DRAX, BARB) — same URL as R3; separate claims — https://press.disneyadvertising.com/where-fandom-meets-measurable-impact:-the-evolution-of-disneys-advertising-technology-ecosystem-in-emea — retrieved 2026-08-20
- [R7] Disney Advertising press — "Disney+ Expands Advertising Automation and Measurement Capabilities, 10 Months After Successful AVOD Launch" — https://press.disneyadvertising.com/disney+-expands-advertising-automation-and-measurement-capabilities,-10-months-after-successful-avod-launch — retrieved 2026-08-20
- [R8] Disney Advertising press — "Disney Delivers Slate of New Streaming Ad Innovation..." (KERV Sync/L-Bar/Impulse; BrightLine Quiz Show/Beat the Clock on Hulu/ESPN) — https://press.disneyadvertising.com/disney-delivers-slate-of-new-streaming-ad-innovation-to-fuel-greater-interactivity-and-engagement — retrieved 2026-08-20
- [R9] Disney Advertising press — "From Screen to Shopping Cart: Disney Makes Streaming Ads Shoppable and Actionable" — https://press.disneyadvertising.com/from-screen-to-shopping-cart-disney-makes-streaming-ads-shoppable-and-actionable — retrieved 2026-08-20
- [R10] The Walt Disney Company — "Viewer-First, Premium Advertising" (Gateway Go 2025-04, Pause Ads 2025-10, Pause+ winter 2025, Ad Selector early 2026) — https://thewaltdisneycompany.com/news/viewer-first-premium-advertising/ — retrieved 2026-08-20
- [R11] The Desk — "Disney adds new selectable ad formats" (corroboration of DXC suite on Disney+ ad tier) — https://thedesk.net/2026/06/disney-new-selectable-ad-formats/ — retrieved 2026-08-20
- [R12] IAB Tech Lab — VAST standard (4.3 current; CTV Addendum 2024) — https://iabtechlab.com/standards/vast/ — retrieved 2026-08-20
- [R13] IAB Tech Lab — SIMID standard (VPAID replacement, SSAI) — https://iabtechlab.com/standards/simid/ — retrieved 2026-08-20
- [R14] IAB Tech Lab — CTV Programmatic Guide (VAST 4.x + OM SDK, mezzanine for SSAI, no VPAID) — https://iabtechlab.com/standards-old/ctv-programmatic-guide/ — retrieved 2026-08-20
- [R15] IAB Tech Lab — CTV Ad Portfolio (final 2026-07-22; six formats; Disney quote) + press release — https://iabtechlab.com/standards/ctv-ad-portfolio/ and https://iabtechlab.com/press-releases/iab-tech-lab-announces-ctv-ad-portfolio/ — retrieved 2026-08-20
- [R16] IAB UK — "Two minutes on the New Online Ad Portfolio" — https://www.iabuk.com/standards-guidelines/two-minutes-new-online-ad-portfolio — retrieved 2026-08-20
- [R17] IAB UK — "Digital Video Principles: Creative Best Practice" — https://www.iabuk.com/standards-guidelines/digital-video-principles-creative-best-practice — retrieved 2026-08-20
- [R18] Disney Advertising media kit — "Disney+ Advertising Inventory Guidelines" (US/Canada/ANZ only) — https://www.disneyadvertising.com/mediakit/disney-plus/disney-plus-ad-guidelines/ — retrieved 2026-08-20
- [R19] What's On Disney Plus — "Disney+ Ad-Supported Tier Launches in the UK" (fan site; London launch event details) — https://whatsondisneyplus.com/disney-ad-supported-tier-launches-in-the-uk/ — retrieved 2026-08-20
- [R20] Disney Advertising — "Disney+ Video Commercial EMEA" spec (2023 edition PDF, search-excerpt only) — https://www.disneyadvertising.com/wp-content/uploads/2023/09/disneyplus_video_emea_english.pdf — retrieved 2026-08-20

## Process Appendix

### Triage

- Tier: STANDARD (moderate question with alternatives; informs a schema design decision). Source mode: web (external specs/standards; no local repo content relevant).
- Tracks: T1 "Disney+ UK ad tier & offered formats"; T2 "Technical creative asset specs"; T3 "IAB & interoperability standards". Rationale: three non-overlapping angles — market scope, hard technical constraints, and the standards layer that constrains serving.
- Assumption recorded: "creative assets" = advertising creative formats/specs accepted by Disney+ (UK). Alternative reading (content artwork delivery specs) noted as U7.

### Researcher reports

- T1 returned 14 claims (7 high / 7 medium confidence) covering UK launch, EMEA footprint, US-origin interactive formats, and the EMEA media kit/spec hub incl. the "no EMEA inventory-guidelines PDF" gap finding. Evidence-weighted: high-confidence official newsroom claims used; the fan-site UX facts (U4) demoted to unverified; the 2023 PDF snippet (U5) superseded by the current PDF.
- T2 returned 17 claims (16 high / 1 medium) all from the EMEA spec PDF [R5] plus the US product hub pages (Gateway Go [R10a], Interactive/BrightLine-Innovid-KERV [R10b]) and US video-commercial product page. Evidence-weighted: EMEA-spec claims are the schema's source; US-hub claims corroborate the format family but are not UK evidence; loudness/HEVC/CMAF/companion absence recorded.
- T3 returned 15 claims (14 high / 1 medium) on VAST/SIMID/OM SDK/CTV Programmatic Guide/CTV Ad Portfolio (Disney publicly endorsed) + EMEA delivery stack. Evidence-weighted: IAB claims are general-industry and marked as such; MPR claim explicitly not confirmed and excluded.

### Challenge verdicts

- CLAIM 1 (EMEA spec = operative UK doc, pre-roll/mid-roll scope): **uphold**. Challenger re-downloaded the 3-page PDF ("Last Update: Nov, 19, 2025"); opening line verbatim; media-kit index confirms only EMEA/LATAM/ANZ international trees (no UK-only spec). Caveat recorded: PDF internal scope says "international regions" and internal title is "Disney+ Video Ad"; the EMEA label is the media-kit name.
- CLAIM 2 (technical constraints): **uphold**. Every quoted constraint verified character-verbatim on page 2 of the PDF; 16:9/1920x1080 confirmed in the EMEA document itself, not borrowed from a US page.
- CLAIM 3 (serving constraints): **downgrade** — site-served misread. All quoted sentences verified, but the availability table (reconstructed from word coordinates) shows **Site-Served = Yes** on Desktop/Mobile/Apps/OTT and VPAID = No; the PDF also references a "VAST & Site-served Video Spec". Corrected: site-served accepted; VPAID not supported. Fixed in K4, Section 3, and schema `serving.siteServed` (const true).
- CLAIM 4 (creative content rules): **uphold**. All six quotes verified verbatim on page 3.
- CLAIM 5 (UK ad tier facts): **uphold**. All three sources verified live; "15 European markets" noted as wording diff vs "15 EMEA markets".
- CLAIM 6 (interactive formats US-origin, UK unconfirmed): **uphold**. Verbatim verification of all dates; independent anti-anchoring sweep of press.disneyadvertising.com, CES-2026, D23-2026 found no UK/EMEA confirmation; noted as absence-of-evidence, not evidence-of-absence.
- CLAIM 7 (IAB layer): **downgrade (minor)** — "Disney publicly co-leading" overreach; Milano quote is an endorsement, not a taskforce-lead claim. Corrected to "publicly endorsed" in K8 and Section 3.
- CLAIM 8 (schema faithfully encodes evidence): **downgrade** — all constraints match the evidence except `siteServed` (encoded false, evidence says true). Fixed; otherwise encoding faithful.
- Suggest_new_claim items: (a) site-served accepted — added (K4, schema); (b) "VAST & Site-served Video Spec" companion absent — added as U9; (c) unencoded acceptance constraints (1 video track, pull-down removal, deinterlace, audio required, color space not unknown) — already encoded in schema `video`/`audio` subschemas at draft time; (d) player overlay "Ad" logo/countdown + privacy restriction — added to Section 3 and schema `creativeRules.thirdPartyTrackingMayBeRestricted`; (e) approved-vendor mechanism unpublished — added as U8; (f) DRAX migration as nearest signal for future interactive formats — recorded as track note, not encoded.

### Judge scores

- SCORE 1 — factual accuracy: 0.9 PASS (all claims match challenge log and verified PDF; flagged "39 claims" vs 46 inconsistency). | SCORE: 0.9 PASS
- SCORE 2 — citation accuracy: 1.0 PASS (every reference has URL + retrieval date; every [Rn] resolves to a matching reference; R6 "same URL as R3; separate claims" annotation transparent; challenge independently verbatim-verified the key PDF claims).
- SCORE 3 — completeness: 1.0 PASS (all 9 skeleton parts present in exact order and non-empty; all Key Findings verdict-labeled and cited; journal embedded).
- SCORE 4 — clarity: 0.9 PASS (schema parsed cleanly; all $ref targets exist in $defs; required arrays are subsets of properties; example asset valid; flagged draft-04 `exclusiveMaximum: false` syntax smell).
- OVERALL: PASS. Judge-flagged issues: (1) "39 claims" -> 46; (2) appendix T3 line retained pre-downgrade "co-lead" wording; (3) `exclusiveMaximum: false` is draft-04 syntax.

### Remediation log

- C3 downgrade (site-served): applied by primary — K4 reworded; Section 2 diagram serving line updated; Section 3 reworded; schema `serving.siteServed` changed `const: false` -> `const: true` with corrected description; example JSON updated. Re-verified: matches availability table (Site-Served = Yes) and the PDF's "VAST & Site-served Video Spec" reference.
- C7 downgrade (co-lead -> endorsed): applied by primary — K8 and Section 3 reworded. Re-verified: quote is an endorsement ("Interoperability is essential to unlocking the full potential of CTV").
- C8 downgrade (schema): applied by primary — siteServed fix (above); all other schema constraints re-checked 1:1 against the quoted PDF page-2/page-3 requirements. Re-verified: faithful.
- suggest_new_claim (d): overlay + privacy — applied: Section 3 sentence added; `creativeRules.thirdPartyTrackingMayBeRestricted` added to schema (const true, required). Re-verified: "Ad" logo/countdown overlay and privacy restriction are PDF content per challenger's coordinate-level extraction.
- suggest_new_claim (e), (b): recorded as U8 (approved vendors unpublished) and U9 (VAST & Site-served Video Spec absent) in Unverified Claims.
- suggest_new_claim (f): recorded as a track note (DRAX/Disney Ad Server EMEA migration is the nearest signal interactive formats may reach the UK; not encoded).
- J1 (judge, exec summary count): "39 claims" -> "46 claims" in Executive Summary. Re-verified: T1 14 + T2 17 + T3 15 = 46.
- J2 (judge, appendix wording): appendix T3 line "Disney co-lead" -> "Disney publicly endorsed". Re-verified: consistent with K8 and Section 3.
- J3 (judge, schema syntax): removed draft-04 `exclusiveMaximum: false` from `fileWeightGB` (draft-07 expects numeric; `maximum: 1.9` already inclusive). Re-verified: schema is valid draft-07 keyword usage.

### Verification

- Citation verification (STANDARD scale — challenger- and judge-flagged claims + conclusion claims): PASS. Challenger re-fetched every source live and verbatim-verified 20+ quoted strings (PDF page-2/page-3 at coordinate level; UK/TWDC press; EMEA newsroom; IAB pages; media kits). Primary spot-checked the two conclusion-bearing sources directly at VERIFY: the EMEA media-kit hub (R4) renders "Disney+ Video Commercial EMEA" with the 6-language spec links; the EMEA newsroom article (R3/R6, June 30 2026, Deborah Armstrong SVP EMEA/UK&I) contains the Disney Ad Server, 10+ DSPs (Amazon DSP, The Trade Desk, DV360), DRAX, and BARB first-SVOD statements verbatim.
- Render check: PASS — format marker line 1, H1, then exactly 8 H2 sections in order (TL;DR, Executive Summary, Key Findings, Detail Sections, Recommendation, Unverified Claims, References, Process Appendix); all non-empty.
- Deliverable check: PASS — embedded JSON Schema extracted and parsed (valid draft-07, 1 JSON block), all `$ref`s (`video`/`audio`/`serving`) resolve in `$defs`, root `required` (10) is a subset of `properties`, no draft-04 keyword remnants after J3.
- Coverage check: PASS — STANDARD required 2-4 tracks (3 delivered), exactly one independent challenge, one independent judge; source mode web honored by all dispatches; QUICK-only primary-led shortcuts not used.
- Redaction check: PASS — no credentials, keys, tokens, or personal data in the finding.
- Protected-state re-run: baseline diff shows working-tree changes beyond the research document (bootstrap/**, csm-scan/test/**, csm-upload/**, tests/**, `D bootstrap/fixtures/tls/key.pem`); these are concurrent workspace activity by other sessions during the run — this run's only write is the research document, the temp dir stayed in /tmp, and nothing was reverted. Recorded per the surface-never-revert rule; no critical incident attributable to this run.
- VERIFY budget: 0 distinct failures.

### Control Journal

[2026-08-20T13:05:00+01:00] INTAKE -> TRIAGE :: cycle 0 :: trigger: start
[2026-08-20T13:05:00+01:00] INTAKE complete :: cycle 0 — no resume candidate for slug `disney-plus-uk-creative-assets` (glob `.agents/research/*-disney-plus-uk-creative-assets-research.md` empty); temp dir `/tmp/csm-deep-research-uaqANL`; protected-state baseline = `git status --short` with pre-existing modifications to `.agents/README.md`, `.agents/plans/2026-08-20-t010-t011-csm.md`, `.lefthook.yml`, `csm-browse/**`, `scripts/*`, untracked `scripts/close-plan.mjs`, `scripts/record-gate-baseline.mjs`, `scripts/with-node22.mjs`, `.agents/docs/gate-baselines.json`, `.agents/docs/journal-lessons.md`, `csm-browse/tests/unit/cleanup.test.mjs`, `csm-browse/tests/unit/recorder.test.mjs`; git root `/home/jamiemills/.config/opencode/skills`.
[2026-08-20T13:07:00+01:00] TRIAGE -> RESEARCH :: cycle 0 :: trigger: classified — tier STANDARD; source mode web (external specs, no local repo content relevant); tracks: T1 "Disney+ UK ad tier & offered formats" (official Disney Advertising/DTC sources, UK launch facts), T2 "Technical creative specs" (video codec/resolution/duration/file/companion/audio), T3 "IAB & interoperability standards" (VAST/VMAP/MRAID, IAB UK, ad-server integration). Clarification OFF — assumption recorded: "creative assets" = advertising creative formats/specs accepted by Disney+ (UK); content-artwork delivery specs are the alternative reading, noted in Unverified Claims.
[2026-08-20T13:07:30+01:00] TRIAGE complete :: cycle 0
[2026-08-20T13:07:35+01:00] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: 3/3 tracks returned
[2026-08-20T13:07:35+01:00] RESEARCH complete :: cycle 0 — 3 researcher dispatches (general subagents, web mode, read-only, no file writes), 46 claims returned, 16 sources, no resilience-ladder incidents.
[2026-08-20T13:21:00+01:00] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft complete — draft written with provisional Key Findings; JSON Schema deliverable embedded in Detail Section 5; every claim carries inline [Rn] citation with URL + retrieval date; unresolved items placed in Unverified Claims (U1-U7).
[2026-08-20T13:21:00+01:00] SYNTHESIZE complete :: cycle 0
[2026-08-20T13:38:00+01:00] CHALLENGE -> REMEDIATE :: cycle 0 :: trigger: 3 downgrades — C3 site-served misread (evidence: availability table Site-Served = Yes; draft said No), C7 "co-leads" overreach (endorsement only), C8 schema siteServed encoding error; 2 suggest_new_claim items adopted (overlay/privacy constraint; approved-vendor + companion-spec unknowns -> U8/U9).
[2026-08-20T13:38:00+01:00] CHALLENGE complete :: cycle 0
[2026-08-20T13:44:00+01:00] REMEDIATE -> JUDGE :: cycle 0 :: trigger: all verdicts resolved — K4/K7/K8 reworded, Section 2/3 updated, schema `siteServed` fixed to true, `thirdPartyTrackingMayBeRestricted` added, example JSON updated, U8/U9 added, remediation log recorded.
[2026-08-20T13:44:00+01:00] REMEDIATE complete :: cycle 0
[2026-08-20T13:55:00+01:00] JUDGE -> REMEDIATE :: cycle 0 :: trigger: 3 flagged issues (all PASS dimensions) — J1 exec-summary claim count 39->46; J2 appendix co-lead wording; J3 schema draft-04 `exclusiveMaximum` syntax.
[2026-08-20T13:55:00+01:00] JUDGE complete :: cycle 0 — scores 0.9 / 1.0 / 1.0 / 0.9, OVERALL PASS, recorded verbatim in Process Appendix.
[2026-08-20T14:00:00+01:00] REMEDIATE -> VERIFY :: cycle 0 :: trigger: judge flags resolved — J1/J2/J3 applied and re-verified; remediation log rows appended.
[2026-08-20T14:00:00+01:00] REMEDIATE complete :: cycle 1
[2026-08-20T14:06:00+01:00] VERIFY -> SAVED :: cycle 0 :: trigger: all gates pass — citation verification PASS (challenger verbatim re-verification + primary spot-check of R4/R3-R6); render check PASS (1 H1 + 8 H2 in order); deliverable JSON parse + $ref resolution PASS; coverage PASS (3 tracks, 1 challenge, 1 judge, web mode); redaction PASS; protected-state re-run recorded concurrent-workspace diff (not caused by this run; surfaced, not reverted); 0 distinct failures.
[2026-08-20T14:06:00+01:00] VERIFY complete :: cycle 0
[2026-08-20T14:07:00+01:00] SAVED complete :: cycle 0 — research document written at `.agents/research/2026-08-20-disney-plus-uk-creative-assets-research.md`; not committed (write discipline; no commit requested); temp dir `/tmp/csm-deep-research-uaqANL` deleted; no parked questions (clarification OFF, no resilience-ladder incidents).
[2026-08-20T15:10:00+01:00] SAVED -> STOP :: cycle 1 :: trigger: skill updated post-run to support run artifacts — schema deliverable retroactively declared as run artifact; extracted verbatim to `.agents/research/artifacts/2026-08-20-disney-plus-uk-creative-assets-schema.json`; embedded block retained inline; finding references the artifact file per the updated Write Discipline And File Allowlist.
