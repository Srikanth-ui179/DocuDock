/**
 * Utility functions for math and markdown text cleaning and formatting.
 */

/**
 * Converts raw LaTeX or math strings to a clean, human-readable plain-text fallback
 * if KaTeX parsing fails or encounters malformed expressions.
 */
export function latexToPlainTextFallback(latex) {
  if (!latex) return '';
  let s = latex.trim();

  // Strip enclosing math delimiters
  s = s.replace(/^\$\$|\$\$$|^\\\[|\\\]$|^\$|\$$|^\\\(|\\\)$/g, '').trim();

  // Common descriptive variable replacements before stripping LaTeX
  s = s.replace(/ERTT_\{prev\}|ERTTprev/g, 'Previous Estimated RTT');
  s = s.replace(/\\text\{EstimatedRTT\}|EstimatedRTT/g, 'Estimated RTT');
  s = s.replace(/\\text\{SampleRTT\}|SampleRTT/g, 'Sample RTT');
  s = s.replace(/\\text\{DevRTT\}|DevRTT/g, 'RTT Deviation (DevRTT)');
  s = s.replace(/\\text\{RTO\}|RTO/g, 'RTO');

  // Fractions: \frac{a}{b} -> (a / b)
  while (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)');
  }

  // Greek letters
  s = s.replace(/\\alpha\b/g, 'Alpha');
  s = s.replace(/\\beta\b/g, 'Beta');
  s = s.replace(/\\eta\b/g, 'Efficiency (η)');
  s = s.replace(/\\gamma\b/g, 'Gamma');
  s = s.replace(/\\delta\b/g, 'Delta');
  s = s.replace(/\\theta\b/g, 'Theta');
  s = s.replace(/\\lambda\b/g, 'Lambda');
  s = s.replace(/\\mu\b/g, 'Mu');
  s = s.replace(/\\pi\b/g, 'π');
  s = s.replace(/\\sigma\b/g, 'Sigma');
  s = s.replace(/\\tau\b/g, 'Tau');
  s = s.replace(/\\omega\b/g, 'Omega');

  // Math symbols
  s = s.replace(/\\times\b/g, '×');
  s = s.replace(/\\cdot\b/g, '·');
  s = s.replace(/\\approx\b/g, '≈');
  s = s.replace(/\\le\b|\\leq\b/g, '≤');
  s = s.replace(/\\ge\b|\\geq\b/g, '≥');
  s = s.replace(/\\ne\b|\\neq\b/g, '≠');
  s = s.replace(/\\pm\b/g, '±');
  s = s.replace(/\\infty\b/g, '∞');
  s = s.replace(/\\quad|\\qquad/g, '  ');
  s = s.replace(/\\text\{([^}]+)\}/g, '$1');
  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\\lfloor\s*([^{}]+)\s*\\rfloor/g, '⌊$1⌋');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\([a-zA-Z]+)/g, '$1'); // strip remaining unknown TeX macros
  s = s.replace(/[{}]/g, ''); // strip remaining bare braces
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}
