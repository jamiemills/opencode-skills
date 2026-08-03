import { validateStandardsRegistry } from './policy.mjs';

export const STANDARDS_REGISTRY_VERSION = 2;

export const STANDARDS_REGISTRY = validateStandardsRegistry([
  {
    id: 'std:aicpa-soc2-tsc:2017-rpof-2022',
    publisher: 'American Institute of Certified Public Accountants',
    title: 'SOC 2 Trust Services Criteria',
    editionKey: '2017-rpof-2022',
    edition: '2017 Trust Services Criteria (with Revised Points of Focus - 2022)',
    publicationDate: '2023-09-30',
    officialUri: 'https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022',
    disposition: 'metadata_only',
  },
  {
    id: 'std:iso-iec-27001:2022',
    publisher: 'International Organization for Standardization and International Electrotechnical Commission',
    title: 'ISO/IEC 27001',
    editionKey: '2022',
    edition: 'ISO/IEC 27001:2022, edition 3',
    publicationDate: '2022-10',
    officialUri: 'https://www.iso.org/standard/82875.html',
    disposition: 'metadata_only',
  },
  {
    id: 'std:oasis-sarif:2.1.0-errata01',
    publisher: 'OASIS Open',
    title: 'Static Analysis Results Interchange Format (SARIF)',
    editionKey: '2.1.0-errata01',
    edition: 'Version 2.1.0 Plus Errata 01',
    publicationDate: '2023-08-28',
    officialUri: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html',
    disposition: 'metadata_only',
  },
  {
    id: 'std:openvex-spec:0.2.0',
    publisher: 'OpenVEX Project',
    title: 'OpenVEX Specification',
    editionKey: '0.2.0',
    edition: 'v0.2.0',
    publicationDate: '2023-08-22',
    officialUri: 'https://github.com/openvex/spec/releases/tag/v0.2.0',
    disposition: 'metadata_only',
  },
  {
    id: 'std:owasp-asvs:5.0.0',
    publisher: 'OWASP Foundation',
    title: 'OWASP Application Security Verification Standard',
    editionKey: '5.0.0',
    edition: '5.0.0',
    publicationDate: '2025-05-30',
    officialUri: 'https://owasp.org/www-project-application-security-verification-standard/',
    disposition: 'metadata_only',
  },
  {
    id: 'std:owasp-cyclonedx:1.7',
    publisher: 'OWASP Foundation and Ecma International',
    title: 'CycloneDX',
    editionKey: '1.7',
    edition: '1.7',
    publicationDate: '2025-10-21',
    officialUri: 'https://cyclonedx.org/specification/overview/',
    disposition: 'metadata_only',
  },
  {
    id: 'std:owasp-top10:2025',
    publisher: 'OWASP Foundation',
    title: 'OWASP Top 10',
    editionKey: '2025',
    edition: '2025',
    publicationDate: null,
    officialUri: 'https://owasp.org/Top10/2025/',
    disposition: 'metadata_only',
  },
  {
    id: 'std:pci-dss:4.0.1',
    publisher: 'PCI Security Standards Council',
    title: 'Payment Card Industry Data Security Standard',
    editionKey: '4.0.1',
    edition: '4.0.1',
    publicationDate: '2024-06-11',
    officialUri: 'https://www.pcisecuritystandards.org/document_library/?category=pcidss&document=pci_dss',
    disposition: 'metadata_only',
  },
  {
    id: 'std:spdx-spec:2.3.0',
    publisher: 'Linux Foundation',
    title: 'Software Package Data Exchange (SPDX) Specification',
    editionKey: '2.3.0',
    edition: '2.3.0',
    publicationDate: '2022-11-03',
    officialUri: 'https://spdx.github.io/spdx-spec/v2.3/',
    disposition: 'metadata_only',
  },
  {
    id: 'std:w3c-wcag:2.2-rec-20241212',
    publisher: 'World Wide Web Consortium',
    title: 'Web Content Accessibility Guidelines (WCAG)',
    editionKey: '2.2-rec-20241212',
    edition: '2.2, W3C Recommendation 12 December 2024 (REC-WCAG22-20241212)',
    publicationDate: '2024-12-12',
    officialUri: 'https://www.w3.org/TR/2024/REC-WCAG22-20241212/',
    disposition: 'metadata_only',
  },
]);

export function getStandardsRegistry() {
  return STANDARDS_REGISTRY;
}

export function standardById(id) {
  return STANDARDS_REGISTRY.find((entry) => entry.id === id) ?? null;
}
