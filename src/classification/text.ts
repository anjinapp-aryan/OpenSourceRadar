const CJK = /[⺀-鿿豈-﫿]/;

/** Lower-case alphanumeric tokens. Any non-letter/digit is a separator (so "CI/CD" -> ["ci", "cd"]). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Repository names are often camelCase ("JavaGuide") or run together ("langchain").
 * Return both readings so a term matches either: ["javaguide"] and ["java", "guide"].
 */
export function nameTokenSets(name: string): string[][] {
  const plain = tokenize(name);
  const camel = tokenize(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'));
  return plain.join(' ') === camel.join(' ') ? [plain] : [plain, camel];
}

export interface CompiledTerm {
  raw: string;
  tokens: string[];
  /** CJK terms are matched as substrings of the lower-cased text (no word boundaries exist). */
  cjk: boolean;
}

export function compileTerm(raw: string): CompiledTerm {
  const lower = raw.toLowerCase();
  return { raw: lower, tokens: tokenize(lower), cjk: CJK.test(lower) };
}

function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    for (let j = 0; j < phrase.length; j += 1) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

/** Text prepared once and matched against many terms. */
export class TextIndex {
  private readonly lower: string;
  private readonly tokenSets: string[][];

  constructor(text: string | null | undefined, options: { camelCase?: boolean } = {}) {
    const t = text ?? '';
    this.lower = t.toLowerCase();
    this.tokenSets = options.camelCase ? nameTokenSets(t) : [tokenize(t)];
  }

  has(term: CompiledTerm): boolean {
    if (term.cjk) return this.lower.includes(term.raw);
    return this.tokenSets.some((tokens) => containsPhrase(tokens, term.tokens));
  }
}

/**
 * Distinct terms (by raw text) that occur in the text, in the order given. A term whose
 * tokens are contained in a longer matched term is dropped ("mcp" inside "mcp server"):
 * one mention must not score twice.
 */
export function matchTerms(index: TextIndex, terms: readonly CompiledTerm[]): CompiledTerm[] {
  const seen = new Set<string>();
  const found: CompiledTerm[] = [];
  for (const term of terms) {
    if (seen.has(term.raw)) continue;
    if (index.has(term)) {
      seen.add(term.raw);
      found.push(term);
    }
  }
  return found.filter((t) => !found.some((o) => o !== t && !o.cjk && !t.cjk && o.tokens.length > t.tokens.length && containsPhrase(o.tokens, t.tokens)));
}

export function normalizeTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
}
