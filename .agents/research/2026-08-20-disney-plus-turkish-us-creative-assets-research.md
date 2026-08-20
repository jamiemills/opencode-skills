format: csm-deep-research/1
# Disney+ Turkish and US Creative Assets Research Finding

## TL;DR

Turkey is served by the Türkçe edition of Disney's EMEA "Disney+ Video Commercial" spec (PDF dated 2025-01-29, EMEA scope): `.mov`/`.mp4`, 16:9, 5-120 seconds (a range — the Turkish edition differs from the English EMEA edition's 15/20/30/60s), 1920x1080 preferred, Apple ProRes/H.264 High, 10-40 Mbps, CFR progressive, YUV, PCM/AAC >=192 Kbps 48 kHz stereo, max 1.9 GB, VAST 2.0/3.0 from approved vendors, pre-roll/mid-roll. The US is served by the "DISNEY+ VIDEO AD" spec (media-kit PDF, last updated 2026-03-05): `.MOV`/`.MP4`/`.M4V`, ProRes 422 HQ/H.264 MP@ML, 4:2:2, CBR 10-40 Mbps, durations 15/30/45/60/75/90 s, audio >=128 Kbps 44.1/48 kHz, VAST 2.0 & 3.0 per the PDF (the product page's Hulu-scoped text says 2.0 only — conflict recorded), 1.9 GB (250 MB Hulu-served). Both markets' verified constraints are stored as two separate JSON schema artifacts.

## Executive Summary

This run researched the Disney+ creative specs for Turkey and the US — the two follow-ups to the earlier UK finding — with the same STANDARD x web pipeline: three parallel tracks (T1 Türkçe spec + Turkey market, T2 US spec + US media kit, T3 US/Turkey market and serving facts), 48 claims from official Disney sources, then challenge, judge, remediation, verify.

```text
Turkish + US spec question -> Triage (STANDARD x web, 3 tracks)
   -> Parallel researchers -> Synthesis -> Challenge -> Judge -> Verified finding
   + 2 declared run artifacts (.json schemas, separate docs per invocation)
```

Headline outcomes. (1) Disney publishes a Türkçe edition of the Disney+ video commercial spec; its document text is EMEA-scoped, and it differs from the English EMEA edition in three verified ways: durations 5-120s (not 15/20/30/60s), letterboxing/black bars rejected outright (English: case-by-case), and a "Disney-Hosted" availability column (English: "Site-Served"). (2) The US's canonical spec PDF (`disneyplus_video.pdf`, © 2023, last updated 2026-03-05) is the operative document, and the US product page (`products.disneyadvertising.com/video-commercial/`) publishes the same specs verbatim as HTML, including US-only rules: .M4V accepted, H.264 Main Profile @ Main Level, 4:2:2 chroma, audio 128 Kbps min at 44.1/48 kHz, durations 15/30/45/60/75/90 s, 250 MB Hulu-served cap vs 1.9 GB elsewhere. The US sources disagree on the VAST version (PDF: 2.0 & 3.0; the Hulu-scoped page text: 2.0 only) — the conflict is recorded, and the schemas encode the canonical PDF's version set. (3) Turkey's ad-supported tier is real: official pricing on disneyplus.com/tr-tr ("Disney+ Reklamlı" 249,90 TL/mo) and a Feb 12, 2025 launch per Turkish press quoting Disney Türkiye; it was NOT part of the Nov 1, 2023 EMEA rollout. The deliverable is two JSON schemas (artifacts), each encoding only verified constraints for its market.

## Key Findings

K1. **supported** — Disney publishes a Türkçe edition of the Disney+ video commercial spec under the EMEA media kit hub; the document's own scope line is EMEA ("EMEA bölgesindeki izleyiciler için"), despite the "international_turkish" filename, and it is dated 2025-01-29. [R1] [R2]

K2. **supported** — Türkçe edition constraints: `.mov`/`.mp4`; duration 5-120 seconds; 16:9, 1920x1080 (1280x720 accepted); 10-40 Mbps; Apple ProRes or H.264 (High profile); 23.98/24/25/29.97/30 FPS native, CFR, progressive; YUV; audio required PCM/AAC, min 192 Kbps, 48 kHz, 2-channel stereo, exactly 1 track matching video; max file weight 1.9 GB. [R2]

K3. **supported** — Türkçe serving/content rules: pre-roll and mid-roll only; Disney-Hosted: Yes; VAST: Yes from Disney+ approved vendors (VAST 2.0 & 3.0, 1x1 pixels); VPAID: No; non-skippable; no JavaScript or `<VASTAdTagURI>` wrappers; clickable CTA copy banned; URLs/hashtags/QR codes only for 18+ profiles; 220x135 px top-right safety zone (player "Ad" logo + countdown); leaders, letterboxing and black bars NOT accepted; 5 business days delivery. [R2]

K4. **supported** — Turkey's ad-supported tier exists: official site lists "Disney+ Reklamlı" at 249,90 TL/month (and "Reklamsız" 449,90 TL/month); launch reported as Feb 12, 2025 (Turkish press quoting Disney Türkiye management); Turkey was not in the Nov 1, 2023 EMEA ad-tier rollout. [R3] [R4] [R5]
K5. **supported** — The US canonical spec is the media-kit PDF `disneyplus_video.pdf` ("DISNEY+ VIDEO AD — Video Ad Formats", © 2023 Disney Advertising, footer last update 2026-03-05), and the US product page `products.disneyadvertising.com/video-commercial/` publishes the specs as HTML; the page governs Disney+ and Hulu long-form breaks. [R6] [R7] [R13]

K6. **supported** — US constraints (product page, verbatim): `.MOV`/`.MP4`/`.M4V`; ProRes 422 HQ or H.264; H.264 Main Profile @ Main Level; 4:2:2 color space; 16:9 required (1:1 or 9:16 rejected); 1920x1080 preferred / 1280x720 accepted; CBR 10-40 Mbps (programmatic: CBR 15-60 preferred, VBR 20-60 accepted; SD 720x480 4:3/16:9 >2 Mbps); 23.98/24/25/29.97/30 FPS CFR progressive; single video track. [R7]

K7. **supported** — US audio/serving/content rules: audio required, 2 channels, >=128 Kbps CBR, 44.1 or 48 kHz, exactly one track matching video, AAC or PCM (16/24-bit for PCM); max file weight 1.9 GB (partner/VAST/programmatic) or 250 MB (Hulu-served); VAST 2.0 & 3.0 per the canonical PDF (the product page's serving language is Hulu-scoped and says VAST 2.0 only — conflict recorded in U1), no wrappers, no iFrame/iLayer/JavaScript/internal-redirect tags, 1x1 trackers + click commands, no VPAID, secure tags required; clickable CTA copy banned; URLs/hashtags accepted; QR codes accepted subject to review; letterboxing/pillarboxing not allowed (exception on request); no leaders; 5 business days turnaround. [R7] [R13]

K8. **supported** — US market facts: ad-supported tier launched Dec 8, 2022 as "Disney+ Basic"; current official US pricing is "Disney+ (With Ads)" at $11.99/month [R11]; 2022 launch coverage stated ~4 min/hour ad load with :15/:30/:45 spot lengths, and Disney's Oct 2023 press announced midrolls and :15s-:90s creatives for Disney+. [R8] [R9] [R10]

K9. **supported** — US duration rule: the canonical US PDF itself lists "Duration • 15, 30, 45, 60, 75, or 90 seconds"; the product page's visible text publishes no duration numbers; Disney's Oct 2023 press corroborates ":15s to :90s". Encoded as the discrete set 15/30/45/60/75/90 in the US schema. [R9] [R13]

K10. **partially-supported** — US safety zones: the product page references "Safety Zones" only via imagery; no numeric values appear in visible text, so the US schema documents the safety-zone rule qualitatively rather than encoding pixel dimensions. [R7]

## Detail Sections

### 1. The Türkçe spec — what Turkish buyers are served (K1, K2, K3)

The EMEA media kit hub lists "Disney+ Video Commercial EMEA" in six languages including Türkçe [R1]; the Turkish link points at `disneyplus_video_international_turkish.pdf`, but the PDF's own opening line scopes it to EMEA: "Bu belge, EMEA bölgesindeki izleyiciler için Disney+ üzerinde Pre-Roll ve Mid-Roll pozisyonlarında yayınlanan spot reklamlarının spec bilgilerini özetlemektedir." [R2]. The document is dated 2025-01-29 (© 2025 Disney Advertising). No Turkey-specific media kit page exists — the International hub lists only EMEA, LATAM, ANZ [R1].

```text
Türkçe spec (disneyplus_video_international_turkish.pdf, 2025-01-29, EMEA scope)
  file: .mov | .mp4              duration: 5-120 s (range, TR edition)
  ratio: 16:9                    res: 1920x1080 | 1280x720
  bitrate: 10-40 Mbps            codec: Apple ProRes | H.264 (High)
  fps: 23.98-30 CFR progressive  color: YUV
  audio: PCM | AAC, >=192 Kbps, 48 kHz, 2-ch stereo, 1 track == video
  weight: <= 1.9 GB              serving: Disney-Hosted Yes; VAST 2.0/3.0
                                  approved vendors; VPAID No; non-skippable
  rules: no clickable CTA; QR/URL 18+ only; 220x135 top-right clear;
         no leaders; no letterbox/black bars; 5 business days
```

Three verified divergences from the English EMEA edition (same hub, 2025-11-19): durations (5-120s range vs 15/20/30/60s), letterboxing (rejected outright vs case-by-case), and the availability table column (Disney-Hosted vs Site-Served) [R2]. The safety-zone reason is stated in the Turkish text: the top-right 220x135 px area "overlaps the player 'Ad' logo and countdown timer" [R2].

### 2. Turkey market status (K4)

Turkey was not in the Nov 1, 2023 EMEA ad-tier rollout — the press release names the nine launch markets, and Türkiye appears only in the "rest of Europe" pricing table with monthly/annual prices (TRY 64.99 / 649.90) and no ads column [R4]. The ad tier exists today: the official Turkish site sells "Disney+ Reklamlı" at 249,90 TL/month (2.499,00 TL/year) [R3]. Turkish tech press reports a Feb 12, 2025 launch at 164,90 TL/month with a statement from Disney Türkiye management ("Bugün, Disney Plus reklam özelliğini sunmaya hazırız...") [R5] — no Disney press release in English or Turkish was located, so the launch date is medium-confidence (and the price has since risen to 249,90 TL). Turkey's plan includes downloads (up to 10 devices) and up to 4K/HDR — unlike the US launch tier [R3].

### 3. The US spec — canonical PDF and the product page (K5, K6, K7)

The US media kit hub links the canonical spec PDF `disneyplus_video.pdf` ("DISNEY+ VIDEO AD — Video Ad Formats", © 2023 Disney Advertising) [R6]; the PDF returns binary to standard retrieval, but the product page publishes the same class of specs as HTML and was quoted verbatim [R7]. The page governs "placement of your advertiser's video creative into any one of Disney+ or Hulu's standard long-form content commercial breaks" [R7].

```text
US spec (disneyplus_video.pdf + products.disneyadvertising.com/video-commercial/)
  file: .MOV | .MP4 | .M4V       codec: Apple ProRes 422 HQ | H.264 (MP@ML)
  duration: 15 | 30 | 45 | 60 | 75 | 90 s (canonical PDF; page shows none)
  ratio: 16:9 (1:1/9:16 rejected) res: 1920x1080 pref | 1280x720 acc
  bitrate: CBR 10-40 Mbps        color: 4:2:2
  programmatic: CBR 15-60 pref | VBR 20-60 acc; SD: 720x480 4:3/16:9 >2 Mbps
  fps: 23.98-30 CFR progressive  video: exactly 1 track
  audio: AAC | PCM, >=128 Kbps CBR, 44.1 or 48 kHz, 2 ch, 16/24-bit PCM,
         1 track == video
  weight: 1.9 GB (partner/VAST/programmatic) | 250 MB (Hulu-served)
  serving: VAST 2.0 & 3.0 per canonical PDF (page's Hulu-scoped text says 2.0
           only — conflict); 1x1 + click commands; no wrappers/iFrame/iLayer/
           JS/internal redirect; no VPAID; secure tags
  rules: no clickable CTA; URLs/hashtags ok; QR ok subject to review;
         no letterbox/pillarbox (exception on request); no leaders;
         5 business days
```

The US page adds programmatic/SD tiers absent from the EMEA docs, and the US file-weight rule splits by serving path (1.9 GB vs 250 MB Hulu-served) [R7]. The canonical US PDF accepts VAST 2.0 & 3.0, while the product page's serving language (literally "Hulu accepts...") says VAST 2.0 only — the schema encodes the PDF's version set and records the conflict [R13] [R7].

### 4. Cross-market comparison (K2 vs K6/K7)

| Constraint | Türkçe edition (EMEA) | US (product page + PDF) |
|---|---|---|
| File formats | .mov, .mp4 | .MOV, .MP4, .M4V |
| Duration | 5-120 s (TR edition; EN/DE EMEA say 15/20/30/60) | 15/30/45/60/75/90 s (canonical PDF) |
| Aspect/res | 16:9; 1080p pref / 720p acc | 16:9 required; 1080p pref / 720p acc |
| H.264 profile | High | Main Profile @ Main Level |
| Color space | YUV | 4:2:2 |
| Bitrate | 10-40 Mbps | CBR 10-40 (prog: CBR 15-60 / VBR 20-60) |
| Audio | >=192 Kbps, 48 kHz only | >=128 Kbps, 44.1 or 48 kHz |
| Max weight | 1.9 GB | 1.9 GB (250 MB Hulu-served) |
| VAST | 2.0 & 3.0 | 2.0 & 3.0 (PDF); page text says 2.0 only |
| VPAID | No | No |
| Letterboxing | Not accepted | Not allowed (exception on request) |
| QR/URL | 18+ profiles only | Accepted (QR subject to review) |
| Safety zone | 220x135 top-right (stated) | Referenced, no numeric value in text |
| Turnaround | 5 business days | 5 business days |

### 5. The deliverable: two JSON schemas (run artifacts)

Per the invocation ("store them in separate json docs"), the verified constraints are encoded as two standalone draft-07 JSON schemas, written as declared run artifacts at SAVED:

- `.agents/research/artifacts/2026-08-20-disney-plus-turkish-creative-assets-schema.json` — Türkçe edition constraints (K1-K3): durations as an integer range 5-120 (per the Turkish edition's own wording "5 - 120 saniye"; the `$comment` flags that EN/DE EMEA editions list 15/20/30/60 — the conflict is recorded, not silently resolved), `letterboxing: not-accepted`, `disneyHosted: true`, VAST 2.0 & 3.0, 18+ QR/URL rule, 220x135 safety zone.
- `.agents/research/artifacts/2026-08-20-disney-plus-us-creative-assets-schema.json` — US constraints (K5-K7, K9): `.MOV`/`.MP4`/`.M4V`, H.264 MP@ML, 4:2:2, audio 128 Kbps min at 44.1/48 kHz, serving-path file-weight split (1.9 GB / 250 MB), durations as the discrete set 15/30/45/60/75/90 (canonical PDF; `$comment` notes the page publishes none and the press corroborates :15-:90), VAST 2.0 & 3.0 per the canonical PDF with the product-page "2.0 only" conflict noted in `$comment`, safety zone documented qualitatively (no numeric values published).

Both schemas follow the UK finding's structure (assetType, fileFormat, durationSeconds, aspectRatio, resolution, video, audio, fileWeightGB, placement, serving, creativeRules) so the corpus schemas validate consistently, with market-specific enums/consts. Unverified items (US safety-zone pixels, Turkey-specific delivery stack, the intra-edition duration conflict's real-world enforcement) stay out of the required surface and are listed in Unverified Claims. Encoding policy as before: only verified constraints enter the schemas.

## Recommendation

Use the two artifact schemas as the validation contracts for Turkish and US Disney+ creatives respectively, alongside the existing UK schema. Confidence: **high** for both markets — every encoded constraint is verbatim from Disney's own documents (Türkçe PDF for Turkey; canonical US PDF + product page for the US), with three recorded caveats: the US sources conflict on VAST version (PDF: 2.0 & 3.0; Hulu-scoped page text: 2.0 only), the Türkçe edition's 5-120s duration conflicts with the EN/DE EMEA editions' 15/20/30/60s, and US safety zones are qualitative only. What would change the answer: an official Disney statement on which VAST versions and which duration set actually service in each market, a Turkey-specific delivery spec, or an official announcement of interactive formats (Gateway Go, Pause Ads, Ad Selector) for Turkey or the US. Cost of being wrong: encoding the English EMEA duration enum into the Turkish schema would wrongly reject 5/10/45/90/120s creatives; encoding EMEA's YUV/High-profile rules into the US schema would wrongly reject .M4V/4:2:2/MP@ML creatives — both avoided by market-specific encoding.

## Unverified Claims

U1. **US VAST version conflict** — unverified which rule governs. The canonical US PDF says "VAST 2.0 & 3.0"; the US product page's serving language (literally "Hulu accepts...") says "VAST 2.0 only" [R7] [R13]. The schema encodes the PDF's version set and records the conflict in `$comment`. To verify: a Disney statement on current US serving, or the "VAST & Site-served Video Spec" companion doc referenced by the EMEA PDF.

U2. **US safety-zone pixels** — unverified. The product page references "Safety Zones" only in imagery [R7]. To verify: obtain the spec PDF's safety-zone graphics or Disney's safety-zone guidelines.

U3. **Turkey launch date and launch pricing** — unverified at official-source level. Feb 12, 2025 and 164,90 TL/month come from Turkish press quoting Disney Türkiye [R5]; official confirmation is current pricing only (249,90 TL/month — the price has risen since launch) [R3]. To verify: a Disney Türkiye or TWDC press release.

U4. **Turkey-specific delivery stack** — unverified. Whether Turkey creatives are served per the EMEA spec's Disney-Hosted/VAST model in practice, or via another path, is not documented. To verify: Disney Advertising EMEA operational statement.

U5. **Türkçe edition duration conflict enforcement** — unverified which duration set actually services in Turkey: the Türkçe edition says 5-120 s while the EN/DE EMEA editions say 15/20/30/60 s [R2] [R14]. The schema encodes the Türkçe edition's own wording (5-120) and flags the conflict. To verify: a Disney Advertising EMEA/Türkiye statement on servable TR durations.

U6. **Amazon DSP as a DRAX partner** — unverified (trade-press reports only; not on an official Disney URL).

U7. **Interactive DXC formats (Gateway Go, Pause Ads, Pause+, Ad Selector) in Turkey or US-market-only scope** — the official "Viewer-First, Premium Advertising" piece describes them on Disney+ (US-first rollout) with no Turkey/EMEA statement; not encoded in either schema.

U8. **US ad load/spot lengths** (:15/:30/:45, ~4 min/hr) are 2022 trade-press reports [R10]; current US policy is not officially quantified. Not encoded.

U9. **US launch price $7.99** — the 2022 launch release's price table renders as an image, so the $7.99 "Disney+ Basic" figure is not machine-verifiable in the cited official text [R8]. Not schema-relevant.

## References

- [R1] Disney Advertising media kit — "Disney+ International" hub (EMEA/LATAM/ANZ) and "Disney+ EMEA MediaKit" (Türkçe link) — https://www.disneyadvertising.com/mediakit/disney-plus/disney-plus-international/ and https://www.disneyadvertising.com/mediakit/disney-plus/disney-plus-international/disney-plus-emea-mediakit/ — retrieved 2026-08-20
- [R2] Disney Advertising — "Disney+ Video Commercial" spec, Türkçe edition (PDF, EMEA scope, dated 2025-01-29, © 2025) — https://files.disneyadvertising.com/MediaKit/Disney-Plus/_International/disneyplus_video_international_turkish.pdf — retrieved 2026-08-20 (verbatim text extracted via local PDF decode in temp dir)
- [R3] Disney+ Türkiye official plans page — "Disney+ Reklamlı 249,90 TL/ay (2.499,00 TL/yıl)" and "Disney+ Reklamsız 449,90 TL/ay (4.499,00 TL/yıl)" — https://www.disneyplus.com/tr-tr — retrieved 2026-08-20
- [R4] Disney UK press release — "Disney+ to launch an ad-supported subscription plan on November 1 in Europe" (9 launch markets; Türkiye table with Standard/Premium pricing only) — https://press.disney.co.uk/news/disney+-to-launch-an-ad-supported-subscription-plan-on-november-1-in-europe — retrieved 2026-08-20
- [R5] Kayıp Rıhtım (Turkish tech press) — "Disney Türkiye reklamlı abonelik dönemi" (Feb 12, 2025 launch; 164,90/349,90 TL; Mehmet İçağasıoğlu quote) — https://kayiprihtim.com/haber/disney-turkiye-reklamli-abonelik-donemi/ — retrieved 2026-08-20
- [R6] Disney Advertising media kit — "Disney+ MediaKit" US hub (Disney+ Video Commercial -> disneyplus_video.pdf; Creative Decline Reasons -> disney_reasons.pdf) — https://www.disneyadvertising.com/mediakit/disney-plus/ — retrieved 2026-08-20
- [R7] Disney Advertising — "Video Commercial" US product page (verbatim specs: resolutions, CBR/bitrate, codec, file formats, file weight, frame rate, programmatic/SD tiers, audio, VAST/serving, CTA/QR, letterboxing, turnaround) — https://products.disneyadvertising.com/video-commercial/ — retrieved 2026-08-20
- [R8] The Walt Disney Company — "Ad-Supported Disney+ Subscription Tier to Launch in the U.S. on December 8" (2022-08-10) and "Ad-Supported Disney+ Plan Now Available in the US" (2022-12-08) — https://thewaltdisneycompany.com/ad-supported-disney-subscription-tier-to-launch-in-the-u-s-on-december-8/ and https://thewaltdisneycompany.com/news/ad-supported-disney-plan-launches-with-more-than-100-advertisers/ — retrieved 2026-08-20
- [R9] Disney Advertising press — "Disney+ Expands Advertising Automation and Measurement Capabilities, 10 Months After Successful AVOD Launch" (midrolls, :15s-:90s, 30 DSPs) — https://press.disneyadvertising.com/disney+-expands-advertising-automation-and-measurement-capabilities,-10-months-after-successful-avod-launch — retrieved 2026-08-20
- [R10] TechCrunch — "Disney launches its ad-supported tier" (2022-12-08; :15/:30/:45; ~4 min/hr) — https://techcrunch.com/2022/12/08/disney-launches-its-ad-supported-tier/ — retrieved 2026-08-20
- [R11] Disney+ US homepage FAQ — "Disney+ (With Ads) for the price of $11.99/month; Disney+ Premium ... $18.99/month or $189.99/year; Ads will be served in select live and linear content for all Disney+ plans" — https://www.disneyplus.com/en-us — retrieved 2026-08-20
- [R12] The Walt Disney Company — "Biddable Technology... Advertising Impact" (Disney Ad Server, DRAX, DV360/TTD/Yahoo/Magnite) — https://thewaltdisneycompany.com/news/biddable-technology-advertising-impact/ — retrieved 2026-08-20
- [R13] Disney Advertising — "DISNEY+ VIDEO AD — Video Ad Formats" (US canonical spec PDF, © 2023 Disney Advertising, footer last update 2026-03-05; contains "Duration • 15, 30, 45, 60, 75, or 90 seconds" and "VAST 2.0 & 3.0") — https://files.disneyadvertising.com/MediaKit/Disney-Plus/disneyplus_video.pdf — retrieved 2026-08-20 (text extracted via local PDF decode by the challenger)
- [R14] Disney Advertising — "Disney+ Video Commercial EMEA" spec, German edition (duration "15, 20, 30, oder 60 Sekunden" — corroborates the intra-family conflict with the Türkçe edition) — https://files.disneyadvertising.com/MediaKit/Disney-Plus/_International/disneyplus_video_emea_deutsch.pdf — retrieved 2026-08-20

## Process Appendix

### Triage

- Tier: STANDARD; source mode: web. Tracks: T1 Türkçe spec + Turkey market; T2 US spec; T3 US/Turkey market + serving facts. Rationale: three non-overlapping angles (one spec per market plus market facts); the UK run's sources were reused only as pointers — every claim re-fetched.
- Assumptions recorded: encode only verified constraints (same policy as UK run); two declared artifact filenames per invocation.

### Researcher reports

- T1: 17 claims (16 high / 1 medium). Located the Türkçe PDF via the EMEA hub; decoded it locally (pypdf in /tmp; disclosed method note); extracted all constraints verbatim in Turkish with translations; identified three verified divergences vs the English EMEA edition (durations, letterboxing, Disney-Hosted column); Turkey ad-tier launch via Turkish press (medium) with official pricing confirmation.
- T2: 18 claims (all high). US product page quoted verbatim (resolutions, codec/profile/color, CBR/VBR tiers, SD tier, audio, VAST/serving rules, CTA/QR, letterboxing, turnaround, weight split); US media kit located disneyplus_video.pdf (binary — flagged U1/U5); guidelines hub located the US inventory-guidelines PDF (binary — out of extractable scope); US launch/pricing facts verified.
- T3: 13 claims (11 high / 2 medium). US Dec 8 2022 launch + current $11.99 pricing; Turkey NOT in Nov 2023 rollout (press table) + Feb 2025 launch (press, medium); US ad server/DRAX/DSP facts; OM SDK context (medium); explicitly declined to re-attribute EMEA/US parameter values from the prior UK run without extraction — correctness verified by T1/T2 verbatim quotes instead.

### Challenge verdicts

- CLAIM A1 (Türkçe edition exists, EMEA scope, dated 2025-01-29): **uphold** — re-fetched; hub meta description verbatim; PDF header "DISNEY+ VIDEO REKLAM / International / © 2025 / son güncelleme: Ocak 29, 2025"; scope line verbatim.
- CLAIM A2 (Türkçe constraints): **uphold** — challenger re-extracted all 114 lines of the PDF; every quoted constraint verbatim, including "5 - 120 saniye", "Maksimum Dosya Boyutu • 1.9 GB", "H.264 Profili • Yüksek", "Sabit Kare Hızı (CFR)". Flag: the 5-120s duration contradicts the EN and DE EMEA editions (both "15, 20, 30, or 60"/"15, 20, 30, oder 60 Sekunden") — recorded as U5.
- CLAIM A3 (Türkçe serving/rules): **uphold** — all quotes verbatim (Disney-Hosted table, VAST 2.0 & 3.0, 1x1, VPAID No, non-skippable, no JS/wrappers, CTA ban, 18+/17&under QR rule, 220x135, leaders/letterbox/black-bars ban, 5 business days).
- CLAIM B1 (US canonical PDF + product page): **uphold** with caveat — PDF title "DISNEY+ VIDEO AD / Video Ad Formats / © 2023" verified; footer reads "last update: March 05, 2026" (© 2023 is a copyright year, not a version date). K5 updated.
- CLAIM B2 (US constraints): **uphold** — all quotes verbatim from the product page's full text; minor note that MP@ML and 4:2:2 appear as standalone bullets (the claim's phrasing implied H.264-scoping; wording kept as the page's own framing).
- CLAIM B3 (US audio/serving/rules): **uphold** with material flag — the VAST rules are literally written as "Hulu accepts..."; the canonical US PDF says "Disney+ accepts standard creative, VAST 2.0 & 3.0". The two US sources disagree on VAST version. Fixed in K7, Section 3, Section 4, schema (encodes PDF's 2.0 & 3.0, conflict recorded as U1).
- CLAIM B4 (US durations absent from page text; press 15-90): **downgrade** — negative half confirmed (grep of full HTML: no duration numbers, no numeric safety zones), but the canonical US PDF itself states "Duration • 15, 30, 45, 60, 75, or 90 seconds"; the press release only corroborates. K9 rewritten: US duration is the discrete set 15/30/45/60/75/90 from the canonical PDF.
- CLAIM C1 (Turkey tier + pricing + rollout exclusion): **uphold** with two precision fixes — tr-tr FAQ verbatim (249,90 TL/ay + plan card); press.co.uk Türkiye row is monthly/annual pricing with no ads column ("Standard/Premium only" wording over-stated, corrected in Section 2); kayiprihtim verbatim with Feb 12, 2025 date and 164,90 TL launch price (price gap to current 249,90 TL noted).
- CLAIM C2 (US launch + current pricing): **uphold** with one under-sourced sub-claim — Dec 8 2022 launch verbatim; $11.99/month verbatim; the $7.99 "Disney+ Basic" launch figure appears only as a price-table image in the cited release → $7.99 dropped from K8, recorded as U9.
- CLAIM D1 (schema design): **mixed** — TR duration 5-120, TR letterboxing, TR disneyHosted, US .M4V/MP@ML/4:2:2, US audio, US weight split, US qualitative safety zone all upheld as faithful. Two corrections applied: (1) US VAST encoded as 2.0 & 3.0 per canonical PDF (not 2.0-only); (2) US duration attributed to the canonical PDF, not press. Plus a flag: TR 5-120 is TR-specific, not EMEA-normal (U5).
- suggest_new_claim: TR/EN/DE duration conflict (-> U5), US VAST conflict (-> U1), US page is Hulu-branded scope (-> noted in K7/Section 3), TR price history (-> Section 2 note), US $7.99 citation gap (-> U9), discrete-vs-range duration (-> TR range vs US enum kept distinct).

### Judge scores

- SCORE 1 — factual accuracy: 0.7 PASS (borderline) — body coherent post-remediation (K9/R13, K7/U1 agree); residual pre-remediation phrasing flagged in TL;DR and Executive Summary (US "VAST 2.0 only"; US duration "per official press").
- SCORE 2 — citation accuracy: 0.75 PASS — every [Rn] resolves with URL + retrieval date; R13/R14 properly cited; two defects: K8's $11.99 sub-claim cited R8/R9/R10 (correct source R11 was orphaned), and U8's :15/:30/:45 figures carried no citation (R10).
- SCORE 3 — completeness: 1.0 PASS — marker, H1, exactly 8 H2s in order; K1-K10 verdict-labeled and cited; embedded Control journal format correct.
- SCORE 4 — clarity: 0.8 PASS — legible; two-artifact deliverable explained; cross-market table well-structured; summary-vs-body tension flagged.
- OVERALL: PASS. Judge-flagged issues: J1 TL;DR US VAST residual; J2 TL;DR US duration attribution; J3 Executive Summary US VAST residual; J4 K8 $11.99 citation (R11 orphaned); J5 U8 missing citation (R10).

### Remediation log

- B4 downgrade (US durations from canonical PDF): applied by primary — K9 rewritten to discrete set 15/30/45/60/75/90 sourced to R13; Detail 3 diagram duration line; Section 4 table duration cell; Detail 5 US schema bullet. Re-verified: challenger extracted "Duration • 15, 30, 45, 60, 75, or 90 seconds" from the PDF.
- D1/US VAST conflict: applied by primary — K7, Detail 3 serving line, Section 4 table, Detail 5, and the US schema encode VAST 2.0 & 3.0 per the canonical PDF with the product-page "2.0 only" conflict recorded as U1 and in `$comment`. Re-verified: PDF text "VAST 2.0 & 3.0" vs page text "Hulu accepts standard tags and supports VAST 2.0 only".
- B1 caveat (footer date): K5 updated to "footer last update 2026-03-05". Re-verified by challenger.
- C1 precision (Türkiye table shape): Section 2 reworded — monthly/annual columns, no ads column. Re-verified against press.co.uk table.
- C2 sub-claim ($7.99): dropped from K8; recorded as U9. Re-verified: price table is an image in the 2022 release.
- suggest_new_claim items: U1 (US VAST conflict), U5 (TR duration conflict), U3 price history note, U9 ($7.99 gap) added; "Hulu-branded scope" noted in K7/Section 3. Discrete-vs-range durations kept distinct (TR range 5-120, US enum 15-90 set).
- J1 (judge, TL;DR US VAST): TL;DR rewritten — "VAST 2.0 & 3.0 per the PDF (the product page's Hulu-scoped text says 2.0 only — conflict recorded)". Re-verified: matches K7/U1.
- J2 (judge, TL;DR duration attribution): TL;DR rewritten — "durations 15/30/45/60/75/90 s" from the canonical PDF. Re-verified: matches K9/R13.
- J3 (judge, Executive Summary US VAST): rewritten with the conflict recorded and PDF version set. Re-verified: matches K7.
- J4 (judge, K8 citation): $11.99 sub-claim now cites [R11]; R11 no longer orphaned. Re-verified: R11 is the Disney+ US FAQ reference.
- J5 (judge, U8 citation): U8 now cites [R10]. Re-verified: R10 is the TechCrunch 2022 launch piece.

### Verification

- Citation verification (STANDARD scale — challenger- and judge-flagged claims + conclusion claims): PASS. Challenger re-fetched every source and verbatim-verified all claims, including direct PDF text extraction of the Türkçe edition, the English/German EMEA editions, and the US canonical PDF; judge verified [Rn] resolution including the remediated R13/R14; primary spot-checks: the EMEA hub meta description, the tr-tr plan card, and press.co.uk table (verified via the challenger's re-fetch notes).
- Render check: PASS — format marker line 1, H1, exactly 8 H2 sections in order (TL;DR, Executive Summary, Key Findings, Detail Sections, Recommendation, Unverified Claims, References, Process Appendix); all non-empty.
- Deliverable check: PASS — two declared run artifacts written at SAVED (Turkish + US schema JSON); both parse as valid draft-07; both referenced from Detail Section 5; the finding references them without embedding (invocation asked for separate docs).
- Coverage check: PASS — STANDARD required 2-4 tracks (3 delivered), exactly one independent challenge, one independent judge; web source mode honored.
- Redaction check: PASS — no credentials, keys, tokens, or personal data in the finding or artifacts.
- Protected-state re-run: baseline diff shows the working tree changed further during the run due to concurrent workspace activity (not caused by this run); this run's only writes are the research document and the two declared artifacts. Surfaced, not reverted.
- VERIFY budget: 0 distinct failures.

### Control Journal

### Control Journal

[2026-08-20T15:30:00+01:00] INTAKE -> TRIAGE :: cycle 0 :: trigger: start
[2026-08-20T15:30:00+01:00] INTAKE complete :: cycle 0 — no resume candidate for slug `disney-plus-turkish-us-creative-assets` (glob `.agents/research/*-disney-plus-turkish-us-creative-assets-research.md` empty); temp dir `/tmp/csm-deep-research-SFp9aF`; protected-state baseline = `git status --short` (95 entries: heavy concurrent workspace churn, pre-existing; this run's only expected new files are the research document and the two declared artifacts); git root `/home/jamiemills/.config/opencode/skills`. Declared run artifacts per invocation ("store them in separate json docs"): `.agents/research/artifacts/2026-08-20-disney-plus-turkish-creative-assets-schema.json` and `.agents/research/artifacts/2026-08-20-disney-plus-us-creative-assets-schema.json`.
[2026-08-20T15:32:00+01:00] TRIAGE -> RESEARCH :: cycle 0 :: trigger: classified — tier STANDARD; source mode web (external official specs; no local repo content relevant); tracks: T1 "Turkish (Türkçe) Disney+ creative spec" (locate and extract the Türkçe spec from the EMEA/International media kit; Turkey market status for the ad tier), T2 "US Disney+ creative spec" (official US media kit + products.disneyadvertising.com video-commercial page + US inventory guidelines; extract all constraints), T3 "US/Turkey market + serving facts" (US ad-tier launch facts, US-only formats context, Turkey ad-tier availability, serving/verification differences). Clarification OFF — assumptions recorded: same deliverable policy as the UK run (encode only verified constraints; unverified formats documented, not encoded); artifacts carry the two declared filenames.
[2026-08-20T15:32:30+01:00] TRIAGE complete :: cycle 0
[2026-08-20T15:33:00+01:00] RESEARCH -> SYNTHESIZE :: cycle 0 :: trigger: 3/3 tracks returned
[2026-08-20T15:33:00+01:00] RESEARCH complete :: cycle 0 — 3 researcher dispatches (web mode, read-only), 48 claims returned, no resilience-ladder incidents; T1 decoded the Türkçe PDF locally (method note: pypdf in /tmp); T2 extracted all specs from the US product page (the US spec PDF itself returns binary); T3 confirmed Turkey ad tier on disneyplus.com/tr-tr and Feb 2025 launch via Turkish press.
[2026-08-20T15:50:00+01:00] SYNTHESIZE -> CHALLENGE :: cycle 0 :: trigger: draft complete — draft written with provisional Key Findings (K1-K10); deliverable = two declared run artifacts (Turkish + US schema JSON), referenced in Detail Section 5 (not embedded — the invocation asked for separate json docs); every claim carries inline [Rn] citation; unresolved items in Unverified Claims (U1-U8).
[2026-08-20T15:50:00+01:00] SYNTHESIZE complete :: cycle 0
[2026-08-20T16:05:00+01:00] CHALLENGE -> REMEDIATE :: cycle 0 :: trigger: 2 downgrades + 1 mixed + flags — B4 (US durations actually in the canonical PDF: 15/30/45/60/75/90, not press-sourced), D1/US VAST conflict (PDF 2.0&3.0 vs Hulu-scoped page 2.0-only), B1 footer-date caveat, C1/C2 precision fixes; 3 new unknowns recorded (U1 US VAST conflict, U5 TR duration conflict, U9 $7.99 citation gap).
[2026-08-20T16:05:00+01:00] CHALLENGE complete :: cycle 0
[2026-08-20T16:12:00+01:00] REMEDIATE -> JUDGE :: cycle 0 :: trigger: all verdicts resolved — K5/K7/K8/K9 rewritten; Detail 3/4/5 updated; U1-U9 restructured; R13/R14 added; remediation log recorded.
[2026-08-20T16:12:00+01:00] REMEDIATE complete :: cycle 0
[2026-08-20T16:25:00+01:00] JUDGE -> REMEDIATE :: cycle 0 :: trigger: 5 flagged issues (all PASS dimensions, 0.7/0.75/1.0/0.8) — J1/J2/J3 summary-layer residuals (US VAST, US duration attribution); J4 K8 $11.99 citation (R11 orphaned); J5 U8 missing citation (R10).
[2026-08-20T16:25:00+01:00] JUDGE complete :: cycle 0 — scores 0.7 / 0.75 / 1.0 / 0.8, OVERALL PASS, recorded verbatim in Process Appendix.
[2026-08-20T16:30:00+01:00] REMEDIATE -> VERIFY :: cycle 0 :: trigger: judge flags resolved — J1-J5 applied and re-verified; remediation log rows appended.
[2026-08-20T16:30:00+01:00] REMEDIATE complete :: cycle 1
[2026-08-20T16:33:00+01:00] VERIFY -> SAVED :: cycle 0 :: trigger: all gates pass — citation verification PASS (challenger verbatim re-fetch incl. PDF text extraction + judge [Rn] audit + primary spot-checks); render check PASS (1 H1 + 8 H2 in order); deliverable check PASS (both artifacts parse as draft-07, referenced from Detail 5); coverage PASS (3 tracks, 1 challenge, 1 judge, web mode); redaction PASS; protected-state re-run recorded concurrent-workspace diff (not caused by this run; surfaced, not reverted); 0 distinct failures.
[2026-08-20T16:33:00+01:00] VERIFY complete :: cycle 0
[2026-08-20T16:35:00+01:00] SAVED complete :: cycle 0 — research document written at `.agents/research/2026-08-20-disney-plus-turkish-us-creative-assets-research.md`; declared run artifacts written at `.agents/research/artifacts/2026-08-20-disney-plus-turkish-creative-assets-schema.json` and `.agents/research/artifacts/2026-08-20-disney-plus-us-creative-assets-schema.json`; not committed (write discipline; no commit requested); temp dir `/tmp/csm-deep-research-SFp9aF` deleted; no parked questions (clarification OFF, no resilience-ladder incidents).
