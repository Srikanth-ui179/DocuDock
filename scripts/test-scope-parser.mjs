/**
 * Scope Query Parser Test
 */

export function parseScopeQuery(query) {
  const clean = query.trim().toLowerCase();

  // 1. Whole document / whole chapter patterns
  const wholeDocRegex = /\b(?:explain|summarize|teach|walk\s+me\s+through|overview|break\s+down)\s+(?:me\s+)?(?:this\s+|the\s+)?(?:entire|whole|all|full)?\s*(?:chapter|document|doc|pdf|book)\b/i;
  const wholeDocDirectRegex = /\b(?:the\s+)?(?:whole|entire|all|full)\s+(?:chapter|document|doc|pdf|book|pages)\b/i;
  const teachEverythingRegex = /\b(?:teach|explain|summarize)\s+(?:me\s+)?everything\b/i;

  if (
    wholeDocRegex.test(clean) ||
    wholeDocDirectRegex.test(clean) ||
    teachEverythingRegex.test(clean)
  ) {
    return {
      isScopeQuery: true,
      scopeType: 'whole_document',
    };
  }

  // 2. "First N pages" or "initial N pages"
  const firstNPagesRegex = /\b(?:first|initial)\s+(\d+)\s+pages?\b/i;
  const matchFirstN = clean.match(firstNPagesRegex);
  if (matchFirstN) {
    const count = parseInt(matchFirstN[1], 10);
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: 1,
      endPage: Math.max(1, count),
    };
  }

  // "First page"
  if (/\b(?:first|initial)\s+page\b/i.test(clean)) {
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: 1,
      endPage: 1,
    };
  }

  // 3. Explicit page ranges: "pages 5-15", "pages 5–15", "pages 5 to 15", "pages 5 through 15", "p. 5-15"
  // Handles unicode dashes: hyphen -, en-dash –, em-dash —
  const rangeRegex = /\b(?:pages?|p\.?|pp\.?)\s*(\d+)\s*(?:-|–|—|to|through)\s*(?:pages?|p\.?|pp\.?)?\s*(\d+)\b/i;
  const matchRange = clean.match(rangeRegex);
  if (matchRange) {
    const p1 = parseInt(matchRange[1], 10);
    const p2 = parseInt(matchRange[2], 10);
    return {
      isScopeQuery: true,
      scopeType: 'range',
      startPage: Math.min(p1, p2),
      endPage: Math.max(p1, p2),
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
    };
  }

  // 4. Single page requests: "explain page 4", "on page 7", "what is on page 12"
  const singlePageRegex = /\b(?:explain|summarize|teach|describe|what\s+is\s+on|show\s+me)?\s*(?:page|p\.)\s*(\d+)\b/i;
  const matchSingle = clean.match(singlePageRegex);
  // Only trigger single-page scope if the query is primarily asking about that page
  if (matchSingle && (clean.includes('page') || clean.includes('p.'))) {
    const pageNum = parseInt(matchSingle[1], 10);
    // If the query is an explanation/summary request for that page
    if (/\b(?:explain|summarize|teach|detail|review|overview|walk|content|what\s+is\s+on)\b/i.test(clean)) {
      return {
        isScopeQuery: true,
        scopeType: 'range',
        startPage: pageNum,
        endPage: pageNum,
      };
    }
  }

  return { isScopeQuery: false };
}

// Test cases
const testQueries = [
  'hello explain me the first 10 pages',
  'Explain the first 10 pages.',
  'Summarize pages 5–15.',
  'pages 5 to 15',
  'What is TCP?',
  'Explain the whole chapter.',
  'teach me this chapter',
  'summarize page 8',
  'What are the three port number ranges defined by ICANN?',
  'Calculate the TCP timeout interval for SampleRTT = 106ms',
  'explain from page 12 through 18',
  'first page summary',
  'give me an overview of the first 20 pages',
];

console.log('Testing Scope Query Parser:\n');
testQueries.forEach((q) => {
  const res = parseScopeQuery(q);
  console.log(`Query: "${q}"`);
  console.log(`Result:`, res);
  console.log('---');
});
