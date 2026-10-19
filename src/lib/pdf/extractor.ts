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
function chunkText(text: string, pageNumber: number, startIndex: number, targetSize = 750, overlap = 120): ExtractedChunk[] {
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

    // Advance cursor with overlap
    cursor = Math.max(cursor + 1, breakPoint - overlap);
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
