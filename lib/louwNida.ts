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
  ref: string | null;          // ln reference for display/citation, e.g. "33.38"
  domainCode: string;          // MARBLE numeric code, e.g. "033006"
  domainLabel: string | null;  // Level-1 label, e.g. "Communication"
  subdomainLabel: string | null; // Level-2 label, e.g. "Speak, Talk"
};

/**
 * Pair each token domain code (lnDomain[i]) with its ln reference (louwNida[i])
 * and resolve labels from a code->label map. The Level-1 domain label is the
 * 3-digit prefix; the subdomain label is the full code (null when the code is
 * only domain-level). Index `i` is the same sense in both arrays.
 */
export function resolveTokenDomains(
  louwNida: string[],
  lnDomain: string[],
  labels: Map<string, string>
): TokenDomainSense[] {
  return lnDomain.map((domainCode, i) => {
    const parent = domainCode.length > 3 ? domainCode.slice(0, 3) : domainCode;
    return {
      ref: louwNida[i] ?? null,
      domainCode,
      domainLabel: labels.get(parent) ?? null,
      subdomainLabel: domainCode.length > 3 ? (labels.get(domainCode) ?? null) : null
    };
  });
}
