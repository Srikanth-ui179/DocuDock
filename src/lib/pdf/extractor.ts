import { extractText } from 'unpdf';

export interface ExtractedChunk {
  chunkIndex: number;
  pageNumber: number;
  content: string;
}

export interface PDFExtractionResult {
  totalPages: number;
  totalCharacters: number;
  chunks: ExtractedChunk[];
  isScannedOrEmpty: boolean;
}

/**
 * Splits text into overlapping segments, attempting to break at sentence or paragraph boundaries.
 */
export function chunkText(text: string, pageNumber: number, startIndex: number, targetSize = 750, overlap = 120): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= targetSize) {
    return [
      {
        chunkIndex: startIndex,
        pageNumber,
        content: normalized,
      },
    ];
  }

  let cursor = 0;
  let currentIndex = startIndex;

  while (cursor < normalized.length) {
    const end = cursor + targetSize;

    if (end >= normalized.length) {
      const slice = normalized.substring(cursor).trim();
      if (slice) {
        chunks.push({
          chunkIndex: currentIndex++,
          pageNumber,
          content: slice,
        });
      }
      break;
    }

    // Attempt to break at punctuation or whitespace near the target end
    let breakPoint = -1;
    const searchWindow = normalized.substring(end - 80, Math.min(end + 60, normalized.length));
    const punctuationMatches = Array.from(searchWindow.matchAll(/[.!?\n]\s+/g));

    if (punctuationMatches.length > 0) {
      // Pick the punctuation match closest to end
      const lastMatch = punctuationMatches[punctuationMatches.length - 1];
      if (lastMatch.index !== undefined) {
        breakPoint = end - 80 + lastMatch.index + lastMatch[0].length;
      }
    }

    // Fallback: look for space
    if (breakPoint === -1) {
      const lastSpace = normalized.lastIndexOf(' ', end);
      if (lastSpace > cursor + targetSize / 2) {
        breakPoint = lastSpace + 1;
      } else {
        breakPoint = end;
      }
    }

    const chunkContent = normalized.substring(cursor, breakPoint).trim();
    if (chunkContent) {
      chunks.push({
        chunkIndex: currentIndex++,
        pageNumber,
        content: chunkContent,
      });
    }

    // Advance cursor with overlap, ensuring chunk boundaries land on sentence, clause, or clean word boundaries
    const rawTarget = breakPoint - overlap;
    let nextCursor = -1;

    // 1. Look for a sentence boundary near rawTarget (within +- 60 chars)
    const overlapWindowStart = Math.max(cursor + 20, rawTarget - 60);
    const overlapWindowEnd = Math.min(breakPoint - 20, rawTarget + 60);
    const overlapWindow = normalized.substring(overlapWindowStart, overlapWindowEnd);
    const sentMatches = Array.from(overlapWindow.matchAll(/[.!?\n]\s+/g));

    if (sentMatches.length > 0) {
      const bestMatch = sentMatches[sentMatches.length - 1];
      if (bestMatch.index !== undefined) {
        nextCursor = overlapWindowStart + bestMatch.index + bestMatch[0].length;
      }
    }

    // 2. Look for a clause boundary (semicolon, comma, colon, bullet)
    if (nextCursor === -1 || nextCursor <= cursor) {
      const clauseMatches = Array.from(overlapWindow.matchAll(/[,;:\u2022\u00B7\uF0B7•·]\s+/g));
      if (clauseMatches.length > 0) {
        const bestMatch = clauseMatches[clauseMatches.length - 1];
        if (bestMatch.index !== undefined) {
          nextCursor = overlapWindowStart + bestMatch.index + bestMatch[0].length;
        }
      }
    }

    // 3. Fallback: snap to clean word boundary
    if (nextCursor === -1 || nextCursor <= cursor) {
      const candidate = Math.max(cursor + 1, rawTarget);
      if (candidate >= breakPoint) {
        nextCursor = cursor + 1;
      } else if (candidate > 0 && normalized[candidate - 1] !== ' ' && normalized[candidate] !== ' ') {
        // Inside a word: find the space preceding this word to keep word intact
        const prevSpace = normalized.lastIndexOf(' ', candidate);
        nextCursor = (prevSpace !== -1 && prevSpace > cursor) ? prevSpace + 1 : candidate;
      } else {
        // On or after a space: advance past any spaces
        let c = candidate;
        while (c < breakPoint && normalized[c] === ' ') c++;
        nextCursor = c;
      }
    }

    cursor = Math.max(cursor + 1, nextCursor);
  }

  return chunks;
}

/**
 * Extracts text and generates overlapping page-tagged chunks from a PDF ArrayBuffer.
 */
export async function extractAndChunkPDF(pdfBuffer: ArrayBuffer): Promise<PDFExtractionResult> {
  const result = await extractText(new Uint8Array(pdfBuffer), { mergePages: false });
  const pages: string[] = Array.isArray(result.text) ? result.text : [String(result.text || '')];
  const totalPages = result.totalPages || pages.length;

  let totalCharacters = 0;
  const chunks: ExtractedChunk[] = [];
  let chunkIndexCounter = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i] || '';
    const trimmed = pageText.trim();
    totalCharacters += trimmed.length;

    if (trimmed.length > 0) {
      const pageChunks = chunkText(trimmed, i + 1, chunkIndexCounter);
      chunks.push(...pageChunks);
      chunkIndexCounter += pageChunks.length;
    }
  }

  // Check if PDF has extractable text (at least 30 characters across the entire file)
  const isScannedOrEmpty = totalCharacters < 30;

  return {
    totalPages,
    totalCharacters,
    chunks,
    isScannedOrEmpty,
  };
}
