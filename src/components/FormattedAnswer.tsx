'use client';

import React, { useState } from 'react';
import katex from 'katex';
import { Check, Copy } from 'lucide-react';
import { Citation } from '@/lib/types';
import { latexToPlainTextFallback } from '@/lib/utils/formatUtils';

import { docNameMatches } from '@/lib/utils/citationUtils';

interface FormattedAnswerProps {
  content: string;
  citations?: Citation[];
  onSelectCitation: (citation: Citation) => void;
  onContinue?: () => void;
}

/**
 * Safely renders LaTeX math using KaTeX with automatic graceful plain-text fallback.
 */
function MathExpression({ math, display = false }: { math: string; display?: boolean }) {
  let html = '';
  let isError = false;
  const cleanMath = math.trim();

  try {
    html = katex.renderToString(cleanMath, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
    });
    if (html.includes('katex-error')) {
      isError = true;
    }
  } catch {
    isError = true;
  }

  if (isError || !html) {
    const fallback = latexToPlainTextFallback(cleanMath);
    return (
      <span
        className={
          display
            ? 'block my-3 px-4 py-2 bg-slate-900/60 rounded-lg border border-slate-800 text-center font-mono text-sm text-blue-200'
            : 'font-mono text-xs text-blue-200 px-1 py-0.5 rounded bg-slate-900/80 border border-slate-800'
        }
      >
        {fallback}
      </span>
    );
  }

  return (
    <span
      className={display ? 'block my-3 text-center overflow-x-auto py-1' : 'inline align-middle mx-0.5'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Code Block component with copy-to-clipboard functionality.
 */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-400">
        <span className="font-mono uppercase font-semibold text-blue-400">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 hover:text-slate-200 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * FormattedAnswer: Parses markdown, math ($...$, $$...$$), citations, and tables
 * into a rich, accessible, beautifully styled presentation.
 */
export function FormattedAnswer({
  content,
  citations,
  onSelectCitation,
  onContinue,
}: FormattedAnswerProps) {
  // Renders inline text, handling bold, italics, inline code, inline math, and citations
  const renderInline = (text: string): React.ReactNode[] => {
    // Regex splits text by:
    // 1. Citations: [DocumentName, p. X]
    // 2. Display math: $$...$$ or \[...\]
    // 3. Inline math: $...$ or \(...\)
    // 4. Inline code: `...`
    // 5. Bold: **...**
    // 6. Italic: *...*
    const tokenRegex = /(\[([^\]]+?,\s*p\.\s*\d+)\]|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|`([^`]+?)`|\*\*([^*]+?)\*\*|\*([^*]+?)\*)/g;

    const nodes: React.ReactNode[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        nodes.push(text.substring(lastIdx, match.index));
      }

      const fullMatch = match[0];

      if (match[2]) {
        // Citation: [DocumentName, p. X]
        const citationText = match[2];
        const pageMatch = citationText.match(/p\.\s*(\d+)/i);
        const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : null;
        const docNamePart = citationText.replace(/,\s*p\.\s*\d+/i, '').trim();

        // 1. Try finding exact match by document name AND page number
        let matchedCitation = citations?.find((c) => {
          const pageMatches = pageNum !== null ? c.page_number === pageNum : true;
          const nameMatches = docNamePart ? docNameMatches(c.document_name, docNamePart) : true;
          return pageMatches && nameMatches;
        });

        // 2. If not found, try matching by page number among citations that match document name
        if (!matchedCitation && pageNum !== null) {
          matchedCitation = citations?.find((c) => c.page_number === pageNum && (!docNamePart || docNameMatches(c.document_name, docNamePart)));
        }

        // 3. If still not found and only one unique document exists in citations, match by page number alone
        if (!matchedCitation && pageNum !== null && citations && citations.length > 0) {
          const uniqueDocs = new Set(citations.map((c) => c.document_name.toLowerCase()));
          if (uniqueDocs.size === 1) {
            matchedCitation = citations.find((c) => c.page_number === pageNum);
          }
        }

        // 4. Construct a valid fallback citation from the token itself instead of picking an unrelated citations[0]
        const effectiveCitation: Citation = matchedCitation || {
          document_id: '',
          document_name: docNamePart || (citations?.[0]?.document_name ?? 'Document'),
          page_number: pageNum || 1,
          content: `Source reference from response: [${citationText}]`,
          similarity: 1.0,
        };

        nodes.push(
          <button
            key={`cit-${match.index}`}
            onClick={() => onSelectCitation(effectiveCitation)}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-medium bg-blue-950/70 text-blue-300 border border-blue-500/30 hover:bg-blue-900/60 hover:text-blue-100 transition-colors align-baseline cursor-pointer"
            title={`Inspect source: ${effectiveCitation.document_name} (Page ${effectiveCitation.page_number})`}
          >
            <span>[{citationText}]</span>
          </button>
        );
      } else if (match[3] || match[4]) {
        // Display math ($$...$$ or \[...\])
        const mathContent = match[3] || match[4];
        nodes.push(<MathExpression key={`dmath-${match.index}`} math={mathContent} display={true} />);
      } else if (match[5] || match[6]) {
        // Inline math ($...$ or \(...\))
        const mathContent = match[5] || match[6];
        nodes.push(<MathExpression key={`imath-${match.index}`} math={mathContent} display={false} />);
      } else if (match[7]) {
        // Inline code (`...`)
        nodes.push(
          <code
            key={`code-${match.index}`}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-900 border border-slate-800 text-blue-300 font-mono text-xs"
          >
            {match[7]}
          </code>
        );
      } else if (match[8]) {
        // Bold (**...**)
        nodes.push(
          <strong key={`b-${match.index}`} className="font-semibold text-slate-100">
            {renderInline(match[8])}
          </strong>
        );
      } else if (match[9]) {
        // Italic (*...*)
        nodes.push(
          <em key={`i-${match.index}`} className="italic text-slate-300">
            {renderInline(match[9])}
          </em>
        );
      } else {
        nodes.push(fullMatch);
      }

      lastIdx = tokenRegex.lastIndex;
    }

    if (lastIdx < text.length) {
      nodes.push(text.substring(lastIdx));
    }

    return nodes;
  };

  // Parses full document blocks (headings, code blocks, display math, tables, lists, paragraphs)
  const renderBlocks = (rawContent: string) => {
    const lines = rawContent.split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 1. Fenced Code Blocks (```)
      if (line.trim().startsWith('```')) {
        const lang = line.trim().replace(/^```/, '').trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          // Guard: if a heading starts, do not swallow it into an unclosed code block
          if (/^#{1,4}\s+/.test(lines[i])) break;
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && lines[i].trim().startsWith('```')) {
          i++; // skip closing ```
        }
        blocks.push(
          <CodeBlock
            key={`block-code-${i}`}
            code={codeLines.join('\n')}
            language={lang}
          />
        );
        continue;
      }

      // 2. Standalone Display Math Block ($$ ... $$ or \[ ... \])
      if (line.trim().startsWith('$$') || line.trim().startsWith('\\[')) {
        const isBracket = line.trim().startsWith('\\[');
        const closeToken = isBracket ? '\\]' : '$$';
        const trimmed = line.trim();
        const startOffset = 2;
        const secondDelim = trimmed.indexOf(closeToken, startOffset);

        if (secondDelim !== -1) {
          // Single-line display math (even if followed by citation or notes)
          const mathContent = trimmed.slice(startOffset, secondDelim).trim();
          const trailing = trimmed.slice(secondDelim + closeToken.length).trim();
          blocks.push(
            <MathExpression
              key={`block-dmath-${i}`}
              math={mathContent}
              display={true}
            />
          );
          if (trailing) {
            blocks.push(
              <p key={`block-trailing-${i}`} className="text-sm text-slate-200 leading-relaxed my-1.5">
                {renderInline(trailing)}
              </p>
            );
          }
          i++;
          continue;
        } else {
          // Multi-line display math
          const mathLines: string[] = [trimmed.slice(startOffset).trim()];
          i++;
          let trailingAfterClose = '';
          while (i < lines.length) {
            const cur = lines[i];
            const closeIdx = cur.indexOf(closeToken);
            if (closeIdx !== -1) {
              mathLines.push(cur.slice(0, closeIdx).trim());
              trailingAfterClose = cur.slice(closeIdx + closeToken.length).trim();
              i++;
              break;
            }
            // Safety guard: if a new heading or code block starts without closing delimiter, break to avoid swallowing
            if (/^#{1,4}\s+/.test(cur) || cur.trim().startsWith('```')) {
              break;
            }
            mathLines.push(cur);
            i++;
          }
          blocks.push(
            <MathExpression
              key={`block-dmath-${i}`}
              math={mathLines.filter(Boolean).join('\n')}
              display={true}
            />
          );
          if (trailingAfterClose) {
            blocks.push(
              <p key={`block-trailing-close-${i}`} className="text-sm text-slate-200 leading-relaxed my-1.5">
                {renderInline(trailingAfterClose)}
              </p>
            );
          }
          continue;
        }
      }

      // 3. Markdown Headings (#, ##, ###)
      const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];

        if (level === 1) {
          blocks.push(
            <h1 key={`h1-${i}`} className="text-xl font-bold text-slate-100 mt-5 mb-2.5 pb-1 border-b border-slate-800">
              {renderInline(headingText)}
            </h1>
          );
        } else if (level === 2) {
          blocks.push(
            <h2 key={`h2-${i}`} className="text-lg font-semibold text-slate-100 mt-4 mb-2 pb-1 border-b border-slate-800/60">
              {renderInline(headingText)}
            </h2>
          );
        } else if (level === 3) {
          blocks.push(
            <h3 key={`h3-${i}`} className="text-sm font-semibold uppercase tracking-wider text-blue-400 mt-3 mb-1.5">
              {renderInline(headingText)}
            </h3>
          );
        } else {
          blocks.push(
            <h4 key={`h4-${i}`} className="text-sm font-semibold text-slate-200 mt-2 mb-1">
              {renderInline(headingText)}
            </h4>
          );
        }
        i++;
        continue;
      }

      // 4. Markdown Tables (| col1 | col2 |)
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }

        if (tableLines.length >= 2) {
          // Parse header
          const parseRow = (rowStr: string) =>
            rowStr
              .slice(1, -1)
              .split('|')
              .map((c) => c.trim());

          const headerCells = parseRow(tableLines[0]);
          // Check if row 1 is separator |---|---|
          const hasSeparator = /^\|[\s-:]+(\|[\s-:]+)+\|$/.test(tableLines[1]);
          const bodyRows = tableLines.slice(hasSeparator ? 2 : 1).map(parseRow);

          blocks.push(
            <div key={`table-${i}`} className="overflow-x-auto my-3 rounded-xl border border-slate-800 bg-slate-900/40">
              <table className="min-w-full divide-y divide-slate-800 text-xs text-left">
                <thead className="bg-slate-900/90 text-slate-300 font-semibold">
                  <tr>
                    {headerCells.map((cell, cIdx) => (
                      <th key={cIdx} className="px-3.5 py-2">
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {bodyRows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-800/30 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // 5. Unordered List Items (- or *)
      if (/^\s*[-*]\s+/.test(line)) {
        const listItems: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
          i++;
        }
        blocks.push(
          <ul key={`ul-${i}`} className="space-y-1.5 my-2 pl-4 text-sm text-slate-200 list-disc list-outside marker:text-blue-400">
            {listItems.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // 6. Ordered List Items (1. , 2. )
      if (/^\s*\d+\.\s+/.test(line)) {
        const listItems: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
          i++;
        }
        blocks.push(
          <ol key={`ol-${i}`} className="space-y-1.5 my-2 pl-5 text-sm text-slate-200 list-decimal list-outside marker:text-blue-400 marker:font-semibold">
            {listItems.map((item, idx) => (
              <li key={idx} className="leading-relaxed">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // 7. Blockquote (> Quote)
      if (line.trim().startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].replace(/^>\s*/, ''));
          i++;
        }
        const fullQuote = quoteLines.join('\n');
        const isWarning = /\[!WARNING\]/i.test(fullQuote);
        const isNote = /\[!NOTE\]/i.test(fullQuote);
        const cleanQuote = fullQuote.replace(/\[!(WARNING|NOTE|IMPORTANT|TIP|CAUTION)\]/gi, '').trim();
        const hasContinuationPrompt = /continue\s+explanation|request\s+a\s+continuation|continue\s+from\s+page/i.test(cleanQuote);

        if (isWarning) {
          blocks.push(
            <div
              key={`bq-warn-${i}`}
              className="border-l-4 border-amber-500/80 bg-amber-950/40 p-3.5 my-3 rounded-r-lg text-amber-200 text-xs leading-relaxed flex flex-col space-y-2"
            >
              <div>{renderInline(cleanQuote)}</div>
              {hasContinuationPrompt && onContinue && (
                <div>
                  <button
                    onClick={onContinue}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-medium transition-colors"
                  >
                    <span>Continue Explanation</span>
                    <span>→</span>
                  </button>
                </div>
              )}
            </div>
          );
        } else if (isNote) {
          blocks.push(
            <div
              key={`bq-note-${i}`}
              className="border-l-4 border-blue-500/80 bg-blue-950/40 p-3.5 my-3 rounded-r-lg text-blue-200 text-xs leading-relaxed flex flex-col space-y-2"
            >
              <div>{renderInline(cleanQuote)}</div>
              {hasContinuationPrompt && onContinue && (
                <div>
                  <button
                    onClick={onContinue}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 text-blue-200 text-xs font-medium transition-colors"
                  >
                    <span>Continue Explanation</span>
                    <span>→</span>
                  </button>
                </div>
              )}
            </div>
          );
        } else {
          blocks.push(
            <blockquote
              key={`bq-${i}`}
              className="border-l-2 border-blue-500/70 pl-3.5 my-2.5 text-slate-300 italic text-sm bg-blue-950/20 py-2 rounded-r-lg"
            >
              {renderInline(cleanQuote)}
            </blockquote>
          );
        }
        continue;
      }

      // 8. Regular paragraph (group non-empty lines)
      if (line.trim() !== '') {
        const paraLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !lines[i].trim().startsWith('#') &&
          !lines[i].trim().startsWith('```') &&
          !lines[i].trim().startsWith('$$') &&
          !lines[i].trim().startsWith('|') &&
          !/^\s*[-*]\s+/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i]) &&
          !lines[i].trim().startsWith('>')
        ) {
          paraLines.push(lines[i]);
          i++;
        }
        blocks.push(
          <p key={`p-${i}`} className="text-sm text-slate-200 leading-relaxed my-2">
            {renderInline(paraLines.join(' '))}
          </p>
        );
        continue;
      }

      i++;
    }

    return blocks;
  };

  return <div className="space-y-1">{renderBlocks(content)}</div>;
}
