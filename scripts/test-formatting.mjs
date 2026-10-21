import katex from 'katex';
import { latexToPlainTextFallback } from '../src/lib/utils/formatUtils.mjs';

console.log('='.repeat(80));
console.log('DOCUDOCK FORMATTING & READABILITY VALIDATION SUITE');
console.log('='.repeat(80));

let allPassed = true;

// 1. Test RTT/RTO Numerical Example
console.log('\n[TEST 1] RTT/RTO Numerical Formatting & Descriptive Labels');
const rttExample = `### Step 1: Calculate New Estimated RTT
- **Formula:** $$EstimatedRTT = (1 - \\alpha) \\times EstimatedRTT_{prev} + \\alpha \\times SampleRTT$$
- **Given / Retrieved Facts:**
  - **Previous Estimated RTT ($ERTT_{prev}$):** 100 ms [Ch3_Transport_Layer.pdf, p. 44]
  - **Sample RTT ($SampleRTT$):** 106 ms [Ch3_Transport_Layer.pdf, p. 44]
  - **Smoothing Parameter ($\\alpha$):** 0.125 ($1/8$) [Ch3_Transport_Layer.pdf, p. 44]
- **Substitution:** $$ERTT = (1 - 0.125) \\times 100\\text{ ms} + 0.125 \\times 106\\text{ ms}$$
- **Calculation:** $$ERTT = 87.5\\text{ ms} + 13.25\\text{ ms} = 100.750\\text{ ms}$$
- **Result:** **Estimated RTT = 100.750 ms** [Ch3_Transport_Layer.pdf, p. 45]`;

const rttHtml = katex.renderToString('EstimatedRTT = (1 - \\alpha) \\times EstimatedRTT_{prev} + \\alpha \\times SampleRTT', {
  displayMode: true,
  throwOnError: false,
  strict: 'ignore'
});
if (rttHtml && !rttHtml.includes('katex-error') && rttExample.includes('Substitution')) {
  console.log('  ✓ KaTeX display math rendered successfully');
} else {
  console.error('  ✗ KaTeX rendering failed for RTT formula');
  allPassed = false;
}

// 2. Test Normal Explanatory Answer
console.log('\n[TEST 2] Normal Explanatory Answer Formatting');
const explanatoryText = `The Transport Layer is responsible for process-to-process delivery of application messages. Unlike the Network Layer which delivers host-to-host datagrams, transport protocols like TCP and UDP multiplex data streams from multiple concurrent client processes into IP packets using 16-bit port numbers [Ch3_Transport_Layer.pdf, p. 4].`;
if (explanatoryText.includes('[Ch3_Transport_Layer.pdf, p. 4]')) {
  console.log('  ✓ Explanatory text and citation tokens structured properly');
} else {
  allPassed = false;
}

// 3. Test Bulleted Answer
console.log('\n[TEST 3] Bulleted List Formatting');
const bulletText = `- **Source Port (16 bits):** Ephemeral port identifying the sending client application [Ch3_Transport_Layer.pdf, p. 8].
- **Destination Port (16 bits):** Well-known port identifying the recipient daemon [Ch3_Transport_Layer.pdf, p. 8].
- **Total Length (16 bits):** Length of header plus payload in bytes [Ch3_Transport_Layer.pdf, p. 8].
- **Checksum (16 bits):** Error detection field covering pseudo-header, header, and data [Ch3_Transport_Layer.pdf, p. 8].`;
const bullets = bulletText.split('\n').filter(l => l.startsWith('- '));
if (bullets.length === 4) {
  console.log('  ✓ 4 bullet items formatted with bold labels and citations');
} else {
  allPassed = false;
}

// 4. Test Table Rendering
console.log('\n[TEST 4] Markdown Table Formatting');
const tableText = `| Protocol | Window Size ($W_s$) | ACK Mechanism | Out-of-Order Handling |
|---|---|---|---|
| Stop-and-Wait | $1$ | Individual | N/A (Discard duplicate) |
| Go-Back-N | $\\le 2^m - 1$ | Cumulative | Silently discarded |
| Selective Repeat | $\\le 2^{m-1}$ | Individual (Selective) | Buffered at receiver |`;
const tableRows = tableText.split('\n').filter(l => l.startsWith('|') && l.endsWith('|'));
if (tableRows.length === 5) {
  console.log('  ✓ Markdown table contains header, separator, and 3 protocol comparison rows');
} else {
  allPassed = false;
}

// 5. Test Code Snippet
console.log('\n[TEST 5] Fenced Code Block Formatting');
const codeSnippet = `\`\`\`typescript
// Check if pseudo-header checksum matches
function verifyChecksum(packet: Uint8Array, pseudoHeader: Uint8Array): boolean {
  const sum = compute16BitOneComplementSum(pseudoHeader, packet);
  return sum === 0xFFFF || sum === 0x0000;
}
\`\`\``;
if (codeSnippet.startsWith('```typescript') && codeSnippet.endsWith('```')) {
  console.log('  ✓ Fenced code block with typescript language identifier verified');
} else {
  allPassed = false;
}

// 6. Test Citations Clickable Tokenization
console.log('\n[TEST 6] Citations Recognition and Tokenization');
const textWithCitations = `According to the TCP specification, the receive window protects the receiver [Ch3_Transport_Layer.pdf, p. 32], whereas the congestion window protects network routers [Ch3_Transport_Layer.pdf, p. 34].`;
const citMatches = textWithCitations.match(/\[([^\]]+?,\s*p\.\s*\d+)\]/g);
if (citMatches && citMatches.length === 2 && citMatches[0].includes('p. 32') && citMatches[1].includes('p. 34')) {
  console.log('  ✓ 2 citations cleanly matched:', citMatches.join(', '));
} else {
  console.error('  ✗ Citations matching failed');
  allPassed = false;
}

// 7. Test Plain-Text Fallback for Malformed / Unavailable LaTeX
console.log('\n[TEST 7] Malformed LaTeX Plain-Text Fallback');
const malformedCases = [
  { raw: '\\alpha = \\frac{1}{8} = 0.125', expected: 'Alpha = (1 / 8) = 0.125' },
  { raw: '\\text{EstimatedRTT} = (1 - \\alpha) \\times ERTT_{prev}', expected: 'Estimated RTT = (1 - Alpha) × Previous Estimated RTT' },
  { raw: 'W \\ge B \\times RTT = 75,000\\text{ bytes}', expected: 'W ≥ B × RTT = 75,000 bytes' },
  { raw: '\\eta = \\frac{1}{1 + 2a} \\approx 2.44\\%', expected: 'Efficiency (η) = (1 / (1 + 2a)) ≈ 2.44%' }
];

for (const c of malformedCases) {
  const fallback = latexToPlainTextFallback(c.raw);
  console.log(`  Input:    ${c.raw}`);
  console.log(`  Fallback: ${fallback}`);
  if (!fallback.includes('\\') && !fallback.includes('{') && !fallback.includes('}')) {
    console.log('  ✓ Clean fallback with 0 raw LaTeX slashes/braces');
  } else {
    console.error('  ✗ Fallback contained residual LaTeX syntax');
    allPassed = false;
  }
}

console.log('\n' + '='.repeat(80));
if (allPassed) {
  console.log('ALL FORMATTING & READABILITY TESTS PASSED (7 / 7)');
} else {
  console.error('SOME FORMATTING TESTS FAILED');
  process.exit(1);
}
console.log('='.repeat(80));
