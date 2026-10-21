import type { Citation, DocumentRecord } from '../types';

/**
 * Normalizes and compares document names.
 * Supports exact match, case-insensitivity, and base name comparison (ignoring .pdf).
 */
export function docNameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const cleanA = a.toLowerCase().replace(/\.pdf$/i, '').trim();
  const cleanB = b.toLowerCase().replace(/\.pdf$/i, '').trim();
  return cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

/**
 * Resolves a citation against active workspace documents.
 * Prioritizes:
 * 1. Exact document_id match if provided.
 * 2. Exact document_name match (case-insensitive).
 * 3. Base filename match (without .pdf extension).
 *
 * Returns null if the document was deleted or is not in the active workspace.
 * Never returns an unrelated document.
 */
export function findMatchedDocument(
  citation: Citation,
  documents?: DocumentRecord[]
): DocumentRecord | null {
  if (!documents || documents.length === 0) return null;

  // 1. Match by exact document_id if provided
  if (citation.document_id) {
    const byId = documents.find((d) => d.id === citation.document_id);
    if (byId) return byId;
  }

  // 2. Match by document_name (case-insensitive exact)
  const citName = (citation.document_name || '').trim().toLowerCase();
  if (citName) {
    const byName = documents.find((d) => d.name.trim().toLowerCase() === citName);
    if (byName) return byName;

    // 3. Match by base name (without .pdf extension)
    const citBase = citName.replace(/\.pdf$/i, '');
    const byBase = documents.find(
      (d) => d.name.trim().toLowerCase().replace(/\.pdf$/i, '') === citBase
    );
    if (byBase) return byBase;
  }

  return null;
}

/**
 * Constructs a PDF viewer navigation URL targeting a specific physical page.
 * Uses the standard PDF open parameters '#page=X'.
 */
export function buildPdfTargetUrl(signedUrl: string, pageNumber: number): string {
  if (!signedUrl) return '';
  return pageNumber > 0 ? `${signedUrl}#page=${pageNumber}` : signedUrl;
}
