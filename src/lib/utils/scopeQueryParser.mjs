/**
 * Scope Query Parser (ESM for Node.js scripts)
 * Detects whether a user query requests a scope-based explanation/summary
 * (e.g. "first 10 pages", "pages 5-15", "whole chapter", "page 4")
 * vs a specific factual/analytical question.
 */

const STOP_PREFIXES = new Set([
  'what', 'topics', 'does', 'did', 'is', 'are', 'was', 'were', 'can', 'could', 'would', 'should',
  'explain', 'summarize', 'summary', 'overview', 'teach', 'describe', 'show', 'tell', 'me', 'about',
  'contents', 'content', 'in', 'into', 'on', 'from', 'for', 'to', 'of', 'under', 'with', 'according',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'please', 'give', 'break', 'down',
  'which', 'how', 'why', 'where', 'find', 'read', 'check', 'see', 'cover', 'covers', 'covered'
]);

export function extractTargetDocumentName(query, knownDocumentNames = []) {
  if (!query || typeof query !== 'string') return undefined;

  // 1. If known document names provided, match against them case-insensitively
  if (knownDocumentNames && knownDocumentNames.length > 0) {
    const queryLower = query.toLowerCase();
    for (const name of knownDocumentNames) {
      const cleanName = name.trim();
      if (!cleanName) continue;
      const nameLower = cleanName.toLowerCase();
      const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[^a-zA-Z0-9_-])' + escaped + '($|[^a-zA-Z0-9_-])').test(queryLower)) {
        return cleanName;
      }
    }
  }

  // 2. Look for quoted filenames first: e.g. "HAP 2.pdf" or 'HAP 2.pdf'
  const quotedMatch = query.match(/['"\u201C\u201D\u2018\u2019]([^'"\u201C\u201D\u2018\u2019]+?\.pdf)['"\u201C\u201D\u2018\u2019]/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  // 3. Match preposition directly preceding filename: e.g. "in HAP 2.pdf", "from HAP 2.pdf", "about HAP 2.pdf"
  const prepPattern = /\b(?:according\s+to|in|from|for|about|into|at|by|of|to|with|within)\s+(?:the\s+)?([a-zA-Z0-9_\-.\s]{1,60}?\.pdf)(?:[,;:?!]|\s+|$)/i;
  const prepMatch = query.match(prepPattern);
  if (prepMatch) {
    const rawName = prepMatch[1].trim();
    const tokens = rawName.split(/\s+/);
    let sIdx = 0;
    while (sIdx < tokens.length && STOP_PREFIXES.has(tokens[sIdx].toLowerCase().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))) {
      sIdx++;
    }
    const filtered = tokens.slice(sIdx).join(' ');
    if (filtered) return filtered.replace(/^[^a-zA-Z0-9]+/, '').trim();
  }

  // 4. Find the .pdf occurrence and look backwards for the filename boundary
  const pdfIndex = query.toLowerCase().indexOf('.pdf');
  if (pdfIndex === -1) return undefined;

  const beforePdf = query.slice(0, pdfIndex).trim();
  const segments = beforePdf.split(/[,?!;:'"()\[\]{}]/);
  const lastSegment = segments[segments.length - 1].trim();

  const prepInLast = lastSegment.match(/\b(?:according\s+to|in|from|for|about|into|at|by|of|to|with|within|does|did|is|are|was|were)\s+(.+)$/i);
  const targetWordsStr = prepInLast ? prepInLast[1] : lastSegment;

  const words = targetWordsStr.split(/\s+/);
  let startIdx = 0;
  while (startIdx < words.length && STOP_PREFIXES.has(words[startIdx].toLowerCase().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))) {
    startIdx++;
  }

  const candidateWords = words.slice(startIdx);
  if (candidateWords.length === 0) return undefined;

  const candidate = candidateWords.join(' ') + '.pdf';
  return candidate.replace(/^[^a-zA-Z0-9]+/, '').trim();
}

export function parseScopeQuery(query, knownDocumentNames = []) {
  const clean = query.trim().toLowerCase();
  const targetDocumentName = extractTargetDocumentName(query, knownDocumentNames);

  // 0. Continuation patterns ("continue", "continue from page 5", "resume explanation", "next pages")
  const continueFromPageRegex = /\b(?:continue|resume|proceed)\s+(?:from|at)\s+(?:page|p\.?)\s*(\d+)(?:\s*(?:to|through|-|–)\s*(?:page|p\.?)?\s*(\d+))?\b/i;
  const matchContinueFrom = clean.match(continueFromPageRegex);
  if (matchContinueFrom) {
    const startP = parseInt(matchContinueFrom[1], 10);
    const endP = matchContinueFrom[2] ? parseInt(matchContinueFrom[2], 10) : undefined;
    return {
      isScopeQuery: true,
      scopeType: 'continuation',
      startPage: startP,
      endPage: endP,
      targetDocumentName,
    };
  }

  const genericContinueRegex = /^(?:continue|resume|go\s+on|proceed|next\s+section|next\s+pages?|continue\s+explanation|tell\s+me\s+the\s+rest|finish\s+the\s+rest)\b/i;
  if (genericContinueRegex.test(clean)) {
    return {
      isScopeQuery: true,
      scopeType: 'continuation',
      targetDocumentName,
    };
  }

  // 1. Whole document / whole chapter / general summary patterns
  const wholeDocRegex = /\b(?:explain|summarize|teach|walk\s+me\s+through|overview|break\s+down)\s+(?:me\s+)?(?:this\s+|the\s+)?(?:entire|whole|all|full)?\s*(?:chapter|document|doc|pdf|book)\b/i;
  const wholeDocDirectRegex = /\b(?:the\s+)?(?:whole|entire|all|full)\s+(?:chapter|document|doc|pdf|book|pages)\b/i;
  const teachEverythingRegex = /\b(?:teach|explain|summarize)\s+(?:me\s+)?everything\b/i;
  // Named document requests: e.g. "Summarize the contents of HAP 2.pdf.", "Summarize HAP 2.pdf", "overview of HAP 2.pdf"
  const docSummaryRegex = /\b(?:summarize|overview|walk\s+me\s+through|break\s+down|explain)\s+(?:me\s+)?(?:the\s+)?(?:contents\s+of\s+)?([a-zA-Z0-9_\-. ]+\.pdf)\b/i;
  const whatIsInDocRegex = /\bwhat\s+(?:is|are)\s+(?:in|the\s+contents\s+of)\s+([a-zA-Z0-9_\-. ]+\.pdf)\b/i;
  const generalSummaryRegex = /^(?:summarize|give\s+me\s+(?:a\s+)?summary|provide\s+(?:a\s+)?summary|give\s+me\s+an\s+overview|overview|what\s+is\s+this\s+about)[.?!]?$/i;

  if (
    wholeDocRegex.test(clean) ||
    wholeDocDirectRegex.test(clean) ||
    teachEverythingRegex.test(clean) ||
    docSummaryRegex.test(clean) ||
    whatIsInDocRegex.test(clean) ||
    generalSummaryRegex.test(clean)
  ) {
    return {
      isScopeQuery: true,
      scopeType: 'whole_document',
      targetDocumentName,
    };
  }

  // 2. "First N pages" or "initial N pages" (e.g. "hello explain me the first 10 pages")
  const firstNPagesRegex = /\b(?:first|initial)\s+(\d+)\s+pages?\b/i;
  const matchFirstN = clean.match(firstNPagesRegex);
  if (matchFirstN) {
    const count = parseInt(matchFirstN[1], 10);
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: 1,
      endPage: Math.max(1, count),
      targetDocumentName,
    };
  }

  // "First page"
  const firstPageSingleRegex = /\b(?:first|initial)\s+page\b/i;
  if (firstPageSingleRegex.test(clean)) {
    return {
      isScopeQuery: true,
      scopeType: 'single_page',
      startPage: 1,
      endPage: 1,
      targetDocumentName,
    };
  }

  // 3. Page range: "pages 5-15", "pages 5 to 15", "page 5 through 10", "p. 5-15", "p. 5 to 15"
  const pageRangeRegex = /\b(?:pages?|p\.?)\s*(\d+)\s*(?:-|–|to|through)\s*(?:pages?|p\.?)?\s*(\d+)\b/i;
  const matchRange = clean.match(pageRangeRegex);
  if (matchRange) {
    const p1 = parseInt(matchRange[1], 10);
    const p2 = parseInt(matchRange[2], 10);
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: Math.min(p1, p2),
      endPage: Math.max(p1, p2),
      targetDocumentName,
    };
  }

  // "from page X to [page] Y"
  const fromToRegex = /\bfrom\s+(?:page\s*)?(\d+)\s+(?:to|through)\s+(?:page\s*)?(\d+)\b/i;
  const matchFromTo = clean.match(fromToRegex);
  if (matchFromTo) {
    const p1 = parseInt(matchFromTo[1], 10);
    const p2 = parseInt(matchFromTo[2], 10);
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: Math.min(p1, p2),
      endPage: Math.max(p1, p2),
      targetDocumentName,
    };
  }

  // 4. Single page requests: "explain page 4", "summarize page 8", "what is on page 12"
  const singlePageRegex = /\b(?:explain|summarize|teach|describe|what\s+is\s+on|show\s+me|review)?\s*(?:page|p\.)\s*(\d+)\b/i;
  const matchSingle = clean.match(singlePageRegex);
  if (matchSingle && (clean.includes('page') || clean.includes('p.'))) {
    const pageNum = parseInt(matchSingle[1], 10);
    if (/\b(?:explain|summarize|teach|detail|review|overview|walk|content|what\s+is\s+on)\b/i.test(clean)) {
      return {
        isScopeQuery: true,
        scopeType: 'single_page',
        startPage: pageNum,
        endPage: pageNum,
        targetDocumentName,
      };
    }
  }

  return { isScopeQuery: false, targetDocumentName };
}
