function parseBlocksTest(input) {
  const lines = input.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Blocks (```)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().replace(/^```/, '').trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        if (/^#{1,4}\s+/.test(lines[i])) break; // safety guard against swallowing headings
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) i++;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Display Math ($$)
    if (line.trim().startsWith('$$')) {
      const trimmed = line.trim();
      const secondDollar = trimmed.indexOf('$$', 2);

      if (secondDollar !== -1) {
        // Single-line display math
        const mathContent = trimmed.slice(2, secondDollar).trim();
        const trailing = trimmed.slice(secondDollar + 2).trim();
        blocks.push({ type: 'math', math: mathContent });
        if (trailing) {
          blocks.push({ type: 'inline-after-math', text: trailing });
        }
        i++;
        continue;
      } else {
        // Multi-line display math
        const mathLines = [trimmed.slice(2).trim()];
        i++;
        while (i < lines.length) {
          const cur = lines[i];
          const closeIdx = cur.indexOf('$$');
          if (closeIdx !== -1) {
            mathLines.push(cur.slice(0, closeIdx).trim());
            const trailing = cur.slice(closeIdx + 2).trim();
            if (trailing) blocks.push({ type: 'inline-after-math', text: trailing });
            i++;
            break;
          }
          if (/^#{1,4}\s+/.test(cur) || cur.trim().startsWith('```')) {
            break; // do not swallow subsequent sections
          }
          mathLines.push(cur);
          i++;
        }
        blocks.push({ type: 'math', math: mathLines.filter(Boolean).join('\n') });
        continue;
      }
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Paragraph/Text
    if (line.trim() !== '') {
      blocks.push({ type: 'para', text: line });
    }
    i++;
  }
  return blocks;
}

const testInput = `### Step 1: Derivation
$$ ERTT = 100.750\\text{ ms} $$ [Ch3_Transport_Layer.pdf, p. 45]

### Step 2: RTO Calculation
- DevRTT is 9.0 ms
- RTO = 136.75 ms

### Step 3: Final Conclusion
The connection parameters are stable.`;

const blocks = parseBlocksTest(testInput);
console.log('Resulting blocks count:', blocks.length);
blocks.forEach((b, idx) => console.log(`Block ${idx}: ${b.type} | ${(b.text || b.math || '').slice(0, 45)}`));
