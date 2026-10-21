/**
 * scopeBatchHelper.ts
 *
 * Dedicated utilities for partitioning page ranges, detecting coverage,
 * deduplicating sections, merging batches, and generating continuations.
 */

export interface PageBatch {
  batchIndex: number;
  totalBatches: number;
  startPage: number;
  endPage: number;
  pageCount: number;
}

/**
 * Computes optimal batch size for physical page explanations.
 * For in-depth technical explanations (which include tables, formulas, and definitions),
 * batches of 3-4 pages guarantee each page receives ~1,000-1,500 tokens of high-fidelity explanation
 * without hitting the 4,096-8,192 provider output token ceiling.
 */
export function calculateOptimalBatchSize(totalRequestedPages: number): number {
  if (totalRequestedPages <= 3) return totalRequestedPages;
  if (totalRequestedPages <= 6) return 3;
  if (totalRequestedPages <= 12) return 3;
  return 4; // Max 4 pages per batch for large multi-page ranges
}

/**
 * Partitions a page range [startPage, endPage] into sequential batches.
 */
export function partitionPageRange(
  startPage: number,
  endPage: number,
  batchSize?: number
): PageBatch[] {
  const totalPages = Math.max(1, endPage - startPage + 1);
  const size = batchSize && batchSize > 0 ? batchSize : calculateOptimalBatchSize(totalPages);

  const batches: PageBatch[] = [];
  let currentStart = startPage;
  let batchIndex = 1;

  while (currentStart <= endPage) {
    const currentEnd = Math.min(currentStart + size - 1, endPage);
    batches.push({
      batchIndex,
      totalBatches: 0, // populated after loop
      startPage: currentStart,
      endPage: currentEnd,
      pageCount: currentEnd - currentStart + 1,
    });
    currentStart = currentEnd + 1;
    batchIndex++;
  }

  for (const b of batches) {
    b.totalBatches = batches.length;
  }

  return batches;
}

/**
 * Scans markdown text to find the highest completed physical page number
 * referenced in headings or explicit page sections.
 * e.g. "### Page 4:", "## Pages 1–3", "[Document.pdf, p. 4]"
 */
export function detectLastCompletedPage(text: string, defaultPage = 1): number {
  let highest = defaultPage;

  // 1. Look for explicit page headers: "Page X", "Pages X-Y", "### [Document.pdf] Page X"
  const pageHeaderRegex = /(?:###?\s*(?:\[[^\]]+\]\s*)?Pages?\s*(\d+)(?:\s*(?:–|-|to)\s*(\d+))?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pageHeaderRegex.exec(text)) !== null) {
    const p1 = parseInt(match[1], 10);
    const p2 = match[2] ? parseInt(match[2], 10) : p1;
    if (!isNaN(p2) && p2 > highest) highest = p2;
    else if (!isNaN(p1) && p1 > highest) highest = p1;
  }

  // 2. Look for citations: [Doc.pdf, p. 4]
  const citationRegex = /\[[^\]]+?,\s*p\.\s*(\d+)\]/g;
  while ((match = citationRegex.exec(text)) !== null) {
    const p = parseInt(match[1], 10);
    if (!isNaN(p) && p > highest) highest = p;
  }

  return highest;
}

/**
 * Normalizes heading title for deduplication comparison.
 */
function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .replace(/\[[^\]]+\]/g, '') // remove citations
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Merges continuation or subsequent batch text into previous text,
 * preventing duplicate section headings or repeated introductory text.
 */
export function mergeBatchResponses(previousText: string, incomingText: string): string {
  const prevTrimmed = previousText.trim();
  const incTrimmed = incomingText.trim();

  if (!prevTrimmed) return incTrimmed;
  if (!incTrimmed) return prevTrimmed;

  // Strip incomplete token limit warning box from previousText if an incoming continuation is being appended
  const cleanPrev = prevTrimmed
    .replace(
      /\n\n>\s*\[!WARNING\]\s*\n>\s*\*\*Incomplete\s+Response\s+\(Token\s+Limit\s+Reached\)\*\*:[^\n]+(?:\n>[^\n]+)*/gi,
      ''
    )
    .replace(
      /\n\n>\s*\[!NOTE\]\s*\n>\s*\*\*Partial\s+Scope\s+Completed[^\n]+(?:\n>[^\n]+)*/gi,
      ''
    )
    .trim();

  // Extract all existing headings in previous text to prevent duplication
  const existingHeadings = new Set<string>();
  const headingRegex = /^#{1,4}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(cleanPrev)) !== null) {
    existingHeadings.add(normalizeHeading(match[1]));
  }

  // Process incoming text line by line, skipping redundant top-level headers or duplicate sections
  const incomingLines = incTrimmed.split('\n');
  const filteredLines: string[] = [];
  let skippingDuplicateSection = false;

  for (let i = 0; i < incomingLines.length; i++) {
    const line = incomingLines[i];
    const isHeading = /^#{1,4}\s+(.+)$/.test(line);

    if (isHeading) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
      const headingTitle = headingMatch ? normalizeHeading(headingMatch[1]) : '';

      // Skip generic top-level document headers if we already have one
      if (/^comprehensive\s+guide|^summary\s+of\s+pages/i.test(headingTitle) && cleanPrev.includes('#')) {
        continue;
      }

      if (existingHeadings.has(headingTitle)) {
        skippingDuplicateSection = true;
        continue;
      } else {
        skippingDuplicateSection = false;
        existingHeadings.add(headingTitle);
        filteredLines.push(line);
      }
    } else {
      if (!skippingDuplicateSection) {
        filteredLines.push(line);
      }
    }
  }

  const cleanMergedIncoming = filteredLines.join('\n').trim();
  if (!cleanMergedIncoming) return cleanPrev;

  return `${cleanPrev}\n\n---\n\n${cleanMergedIncoming}`;
}

/**
 * Formats a clean continuation banner message when response was truncated or user requested continuation.
 */
export function formatContinuationBanner(lastPageCovered: number, targetEndPage: number): string {
  if (lastPageCovered >= targetEndPage) return '';
  const nextPage = lastPageCovered + 1;
  return `\n\n> [!NOTE]\n> **Partial Scope Completed (Pages through ${lastPageCovered})**: Explanation complete through page ${lastPageCovered}. To explain the remaining pages, simply click **Continue Explanation** or ask *"continue from page ${nextPage}"*.`;
}
