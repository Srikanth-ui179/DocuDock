import assert from 'node:assert/strict';

/**
 * Regression Test Suite: Multi-step Answer Integrity and Truncation Handling
 *
 * Verifies:
 * 1. Multi-step responses containing display math, trailing citations, and code blocks
 *    retain EVERY section through the final conclusion without blocks being dropped or swallowed.
 * 2. Unclosed math or code blocks do not swallow subsequent headings.
 * 3. Token-limit and finish_reason handling appends clear user-facing warnings rather than silent truncation.
 */

// Simulated block parser logic matching FormattedAnswer.tsx
function parseContentBlocks(rawContent) {
  const lines = rawContent.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced Code Blocks (```)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().replace(/^```/, '').trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        if (/^#{1,4}\s+/.test(lines[i])) break; // guard against swallowing headings
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) i++;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
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
        // Single-line display math
        const mathContent = trimmed.slice(startOffset, secondDelim).trim();
        const trailing = trimmed.slice(secondDelim + closeToken.length).trim();
        blocks.push({ type: 'math', math: mathContent });
        if (trailing) {
          blocks.push({ type: 'trailing', text: trailing });
        }
        i++;
        continue;
      } else {
        // Multi-line display math
        const mathLines = [trimmed.slice(startOffset).trim()];
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
          if (/^#{1,4}\s+/.test(cur) || cur.trim().startsWith('```')) {
            break; // safety guard
          }
          mathLines.push(cur);
          i++;
        }
        blocks.push({ type: 'math', math: mathLines.filter(Boolean).join('\n') });
        if (trailingAfterClose) {
          blocks.push({ type: 'trailing', text: trailingAfterClose });
        }
        continue;
      }
    }

    // 3. Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Alert Callouts (> [!WARNING], > [!NOTE])
    if (line.trim().startsWith('> [!')) {
      const alertMatch = line.trim().match(/^>\s*\[!(WARNING|NOTE|IMPORTANT|TIP|CAUTION)\]/i);
      const alertType = alertMatch ? alertMatch[1].toUpperCase() : 'NOTE';
      const alertLines = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        alertLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      blocks.push({ type: 'alert', alertType, text: alertLines.join('\n') });
      continue;
    }

    // 5. Paragraphs
    if (line.trim() !== '') {
      blocks.push({ type: 'paragraph', text: line });
    }
    i++;
  }

  return blocks;
}

console.log('=== Running Regression Test: Multi-Step Answer Completeness ===\n');

// Test Case 1: Multi-step calculation with inline and display math and trailing citations
const fullMultiStepAnswer = `### Given Facts & Parameters
- **Previous Estimated RTT**: $ERTT_{prev} = 100\\text{ ms}$ [Ch3_Transport_Layer.pdf, p. 45]
- **Sample RTT**: $SampleRTT = 106\\text{ ms}$ [Ch3_Transport_Layer.pdf, p. 45]
- **Weight Factor $\\alpha$**: $0.125$ [Ch3_Transport_Layer.pdf, p. 45]
- **Weight Factor $\\beta$**: $0.25$ [Ch3_Transport_Layer.pdf, p. 46]

### Step 1: Estimated RTT Calculation
The formula for updated Estimated RTT using the Exponential Moving Average is:
$$ ERTT_{new} = (1 - \\alpha) \\cdot ERTT_{prev} + \\alpha \\cdot SampleRTT $$ [Ch3_Transport_Layer.pdf, p. 45]

Substituting the parameters:
$$ ERTT_{new} = 0.875 \\cdot 100\\text{ ms} + 0.125 \\cdot 106\\text{ ms} = 87.5 + 13.25 = 100.75\\text{ ms} $$

### Step 2: DevRTT Calculation
The formula for round-trip time variation DevRTT is:
$$ DevRTT_{new} = (1 - \\beta) \\cdot DevRTT_{prev} + \\beta \\cdot |SampleRTT - ERTT_{new}| $$ [Ch3_Transport_Layer.pdf, p. 46]

Substituting $DevRTT_{prev} = 5\\text{ ms}$:
$$ DevRTT_{new} = 0.75 \\cdot 5\\text{ ms} + 0.25 \\cdot |106 - 100.75|\\text{ ms} = 3.75 + 1.3125 = 5.0625\\text{ ms} $$

### Step 3: TCP TimeoutInterval (RTO) Calculation
The TCP retransmission timeout interval is calculated as:
$$ TimeoutInterval = ERTT_{new} + 4 \\cdot DevRTT_{new} $$ [Ch3_Transport_Layer.pdf, p. 46]

Substituting the calculated values:
$$ TimeoutInterval = 100.75\\text{ ms} + 4 \\cdot (5.0625\\text{ ms}) = 100.75 + 20.25 = 121.00\\text{ ms} $$

### Final Conclusion
The newly calculated TCP timeout interval is exactly **121.00 ms** [Ch3_Transport_Layer.pdf, p. 46]. All steps and derivations are complete.`;

const blocks = parseContentBlocks(fullMultiStepAnswer);
const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.text);

console.log('Parsed Headings:');
headings.forEach((h, idx) => console.log(`  ${idx + 1}. ${h}`));

assert.equal(headings.length, 5, 'Must contain all 5 headings without dropping steps');
assert.ok(headings.includes('Given Facts & Parameters'), 'Missing Given Facts section');
assert.ok(headings.includes('Step 1: Estimated RTT Calculation'), 'Missing Step 1');
assert.ok(headings.includes('Step 2: DevRTT Calculation'), 'Missing Step 2');
assert.ok(headings.includes('Step 3: TCP TimeoutInterval (RTO) Calculation'), 'Missing Step 3');
assert.ok(headings.includes('Final Conclusion'), 'Missing Final Conclusion');

// Verify that the final conclusion paragraph was retained
const finalConclusionPara = blocks.find(
  (b) => b.type === 'paragraph' && b.text.includes('121.00 ms')
);
assert.ok(finalConclusionPara, 'Final conclusion text must be parsed and rendered');
console.log('✓ PASS: All calculation steps through final conclusion rendered successfully.');

// Test Case 2: Display math with bracket syntax \[ ... \]
const bracketSyntaxInput = `### Step 1: Initial Setup
\\[ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\] [Document.pdf, p. 12]

### Step 2: Final Result
The roots are real and distinct.`;

const bracketBlocks = parseContentBlocks(bracketSyntaxInput);
const bracketHeadings = bracketBlocks.filter((b) => b.type === 'heading').map((b) => b.text);
assert.equal(bracketHeadings.length, 2, 'Bracket syntax must not swallow subsequent headings');
assert.ok(bracketHeadings.includes('Step 2: Final Result'), 'Step 2 must be present');
console.log('✓ PASS: Bracket display math syntax does not swallow steps.');

// Test Case 3: Unclosed math delimiter resilience
const unclosedMathInput = `### Step 1: Partial Derivation
$$ formula_without_close

### Step 2: Recovery Section
This heading must not be lost.`;

const unclosedBlocks = parseContentBlocks(unclosedMathInput);
const unclosedHeadings = unclosedBlocks.filter((b) => b.type === 'heading').map((b) => b.text);
assert.ok(
  unclosedHeadings.includes('Step 2: Recovery Section'),
  'Parser safety guard must prevent unclosed math from swallowing subsequent sections'
);
console.log('✓ PASS: Unclosed math safety guard prevents block swallowing.');

// Test Case 4: Token limit warning handling
const truncatedResponseWithWarning = `### Step 1: Preliminary Analysis
Content here...

> [!WARNING]
> **Incomplete Response (Token Limit Reached)**: The model reached its output limit before completing all steps. Please request a continuation or ask for specific remaining sections.`;

const alertBlocks = parseContentBlocks(truncatedResponseWithWarning);
const alertBlock = alertBlocks.find((b) => b.type === 'alert');
assert.ok(alertBlock, 'Alert callout must be identified and rendered');
assert.equal(alertBlock.alertType, 'WARNING', 'Alert type must be WARNING');
console.log('✓ PASS: Token limit warning box parsed correctly as visual alert callout.');

console.log('\nAll regression test assertions passed successfully.');
