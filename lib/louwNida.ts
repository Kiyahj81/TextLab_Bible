export type LouwNidaDomainRow = {
  code: string;
  level: number;
  label: string;
  parentCode: string | null;
};

type RawNode = {
  Code?: unknown;
  SemanticDomainLocalizations?: Array<{ LanguageCode?: unknown; Label?: unknown }>;
  [key: string]: unknown;
};

function englishLabel(node: RawNode): string | null {
  const loc = (node.SemanticDomainLocalizations ?? []).find((l) => l?.LanguageCode === "en");
  const label = typeof loc?.Label === "string" ? loc.Label.trim() : "";
  return label ? label : null;
}

// Level is derived from code length (3 digits per level) rather than the dataset's
// `Level` field, so it stays consistent even if that field is absent or inconsistent.
// Domains are 3-digit, subdomains 6-digit, deeper levels add 3 digits each.
function levelOf(code: string): number {
  return Math.max(1, Math.floor(code.length / 3));
}

function parentOf(code: string): string | null {
  return code.length > 3 ? code.slice(0, code.length - 3) : null;
}

/**
 * Recursively walk the UBS lexical-domains JSON and emit one row per node that
 * carries a numeric Code and an English label. Works for both flat-array and
 * nested (`Entries`) layouts. Dedupes by code (first English label wins).
 */
export function flattenLouwNidaDomains(json: unknown): LouwNidaDomainRow[] {
  const byCode = new Map<string, LouwNidaDomainRow>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as RawNode;

    const code = typeof node.Code === "string" ? node.Code.trim() : "";
    if (/^\d{3,}$/.test(code) && !byCode.has(code)) {
      const label = englishLabel(node);
      if (label) {
        byCode.set(code, { code, level: levelOf(code), label, parentCode: parentOf(code) });
      }
    }

    for (const child of Object.values(node)) {
      if (child && typeof child === "object") walk(child);
    }
  };

  walk(json);
  return Array.from(byCode.values());
}

export type TokenDomainSense = {
  ref: string | null;          // ln reference(s) for display, e.g. "33.38" or "33.55, 33.56"
  domainCode: string;          // MARBLE numeric code, e.g. "033006"
  domainLabel: string | null;  // Level-1 label, e.g. "Communication"
  subdomainLabel: string | null; // Level-2 label, e.g. "Speak, Talk"
};

/**
 * Resolve a token's domain codes to display senses. Senses are driven by `lnDomain`
 * (the MARBLE codes that resolve to labels): the Level-1 domain label is the 3-digit
 * prefix and the subdomain label is the full code (null when the code is only
 * domain-level).
 *
 * `louwNida` (LN refs) and `lnDomain` (MARBLE codes) are independent multi-value
 * columns at different granularities — a single MARBLE code commonly maps to several
 * LN refs — so they are NOT guaranteed to be the same length. When a token has exactly
 * one domain code, all of its refs are attached to that sense; otherwise refs are
 * paired positionally as a best effort (extra/absent refs degrade to a partial or null
 * citation rather than dropping the label).
 */
export function resolveTokenDomains(
  louwNida: string[],
  lnDomain: string[],
  labels: Map<string, string>
): TokenDomainSense[] {
  return lnDomain.map((domainCode, i) => {
    const parent = domainCode.length > 3 ? domainCode.slice(0, 3) : domainCode;
    const refs =
      lnDomain.length === 1 ? louwNida : louwNida[i] != null ? [louwNida[i]] : [];
    return {
      ref: refs.length > 0 ? refs.join(", ") : null,
      domainCode,
      domainLabel: labels.get(parent) ?? null,
      subdomainLabel: domainCode.length > 3 ? (labels.get(domainCode) ?? null) : null
    };
  });
}
