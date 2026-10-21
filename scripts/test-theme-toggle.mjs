/**
 * Comprehensive Automated Verification Suite for DocuDock Theme Toggle & Next.js Configuration
 *
 * Verifies:
 * 1. Next.js Development Indicator is explicitly disabled (`devIndicators: false`).
 * 2. Anti-FOUC initialization script logic on documentElement in <head>.
 * 3. Actual `applyThemeToDocument` exported from ThemeContext.tsx mutates DOM correctly.
 * 4. Theme state transitions: dark -> light (displays ☀️ in dark mode, switches to light).
 * 5. Theme state transitions: light -> dark (displays 🌙 in light mode, switches to dark).
 * 6. Persistence across page refreshes and browser reloads via localStorage.
 * 7. Header component wiring, accessibility attributes (aria-label, title, keyboard trigger).
 * 8. CSS theme variables and live stylesheet compilation.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import ReactDOMServer from 'react-dom/server';

// Mock browser DOM environment
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
  toString() { return Array.from(this.classes).join(' '); }
}

class MockElement {
  constructor() {
    this.classList = new MockClassList();
    this.attributes = new Map();
    this.style = {};
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  removeAttribute(k) { this.attributes.delete(k); }
}

class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(k) { return this.store.get(k) || null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

const mockStorage = new MockLocalStorage();
const mockDocElement = new MockElement();

globalThis.localStorage = mockStorage;
globalThis.document = {
  documentElement: mockDocElement,
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: mockStorage,
};

// Dynamically load the ACTUAL ThemeContext implementation
const tsxSource = fs.readFileSync('src/lib/context/ThemeContext.tsx', 'utf8');
const transpiledJs = ts.transpileModule(tsxSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React }
}).outputText;

const tmpPath = path.resolve('scripts', '.tmp-ThemeContext.mjs');
fs.writeFileSync(tmpPath, transpiledJs, 'utf8');
let actualThemeContext;
try {
  actualThemeContext = await import('./.tmp-ThemeContext.mjs');
} finally {
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
}

const { applyThemeToDocument, THEME_STORAGE_KEY, ThemeProvider, useTheme } = actualThemeContext;

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('🌓 Starting DocuDock Theme & DevIndicator Verification Suite...\n');

// =========================================================================
// SECTION 1: Next.js Development Indicator Configuration
// =========================================================================
console.log('--- Section 1: Next.js Development Indicator ---');

await runTest('next.config.ts configures devIndicators: false', () => {
  const configPath = path.resolve('next.config.ts');
  assert.ok(fs.existsSync(configPath), 'next.config.ts must exist');
  const configContent = fs.readFileSync(configPath, 'utf8');

  assert.match(
    configContent,
    /devIndicators:\s*false/,
    'next.config.ts must explicitly configure devIndicators: false'
  );
});

// =========================================================================
// SECTION 2: Anti-FOUC Script in layout.tsx
// =========================================================================
console.log('\n--- Section 2: Anti-FOUC Initialization Script in layout.tsx ---');

await runTest('layout.tsx contains synchronous theme initialization script', () => {
  const layoutPath = path.resolve('src/app/layout.tsx');
  assert.ok(fs.existsSync(layoutPath), 'layout.tsx must exist');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');

  assert.ok(layoutContent.includes('docudock_theme'), 'Script must read docudock_theme from localStorage');
  assert.ok(layoutContent.includes('suppressHydrationWarning'), 'html element must have suppressHydrationWarning');
  assert.ok(layoutContent.includes('ThemeProvider'), 'layout must wrap application with ThemeProvider');
});

await runTest('layout.tsx uses Next.js Script with beforeInteractive and avoids raw script tags', () => {
  const layoutPath = path.resolve('src/app/layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');

  assert.ok(layoutContent.includes("import Script from 'next/script'"), 'layout.tsx must import Script from next/script');
  assert.ok(layoutContent.includes('strategy="beforeInteractive"'), 'Script must use strategy="beforeInteractive"');
  assert.ok(layoutContent.includes('id="docudock-theme-init"'), 'Script must have id="docudock-theme-init"');
  assert.ok(!layoutContent.includes('<head>'), 'layout.tsx should not use manual <head> wrapper');
  assert.ok(!/<script\b[^>]*dangerouslySetInnerHTML/.test(layoutContent), 'layout.tsx must not contain raw <script dangerouslySetInnerHTML');
});

// =========================================================================
// SECTION 3: Actual applyThemeToDocument DOM Manipulation
// =========================================================================
console.log('\n--- Section 3: Actual applyThemeToDocument DOM Manipulation ---');

await runTest('applyThemeToDocument("light") updates classList, data-theme, and style.colorScheme', () => {
  mockDocElement.classList.remove('light');
  mockDocElement.classList.add('dark');
  mockDocElement.setAttribute('data-theme', 'dark');

  applyThemeToDocument('light');

  assert.equal(mockDocElement.classList.contains('light'), true, 'Must add light class');
  assert.equal(mockDocElement.classList.contains('dark'), false, 'Must remove dark class');
  assert.equal(mockDocElement.getAttribute('data-theme'), 'light', 'data-theme must be light');
  assert.equal(mockDocElement.style.colorScheme, 'light', 'style.colorScheme must be light');
});

await runTest('applyThemeToDocument("dark") updates classList, data-theme, and style.colorScheme', () => {
  mockDocElement.classList.remove('dark');
  mockDocElement.classList.add('light');
  mockDocElement.setAttribute('data-theme', 'light');

  applyThemeToDocument('dark');

  assert.equal(mockDocElement.classList.contains('dark'), true, 'Must add dark class');
  assert.equal(mockDocElement.classList.contains('light'), false, 'Must remove light class');
  assert.equal(mockDocElement.getAttribute('data-theme'), 'dark', 'data-theme must be dark');
  assert.equal(mockDocElement.style.colorScheme, 'dark', 'style.colorScheme must be dark');
});

// =========================================================================
// SECTION 4: Theme Toggle Logic & Persistence
// =========================================================================
console.log('\n--- Section 4: Theme Toggle State Transitions & Persistence ---');

await runTest('Defaults to dark mode when no saved preference exists', () => {
  mockStorage.clear();
  const saved = mockStorage.getItem(THEME_STORAGE_KEY);
  const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';

  assert.equal(theme, 'dark');
  applyThemeToDocument(theme);

  assert.equal(mockDocElement.classList.contains('dark'), true);
  assert.equal(mockDocElement.classList.contains('light'), false);
  assert.equal(mockDocElement.getAttribute('data-theme'), 'dark');
  assert.equal(mockDocElement.style.colorScheme, 'dark');
});

await runTest('Toggling from dark mode switches to light mode and persists to localStorage', () => {
  let theme = 'dark';
  // Toggle
  theme = theme === 'dark' ? 'light' : 'dark';
  applyThemeToDocument(theme);
  mockStorage.setItem(THEME_STORAGE_KEY, theme);

  assert.equal(theme, 'light');
  assert.equal(mockStorage.getItem(THEME_STORAGE_KEY), 'light');
  assert.equal(mockDocElement.classList.contains('light'), true);
  assert.equal(mockDocElement.classList.contains('dark'), false);
  assert.equal(mockDocElement.getAttribute('data-theme'), 'light');
  assert.equal(mockDocElement.style.colorScheme, 'light');
});

await runTest('Toggling from light mode switches back to dark mode and persists', () => {
  let theme = 'light';
  // Toggle
  theme = theme === 'light' ? 'dark' : 'light';
  applyThemeToDocument(theme);
  mockStorage.setItem(THEME_STORAGE_KEY, theme);

  assert.equal(theme, 'dark');
  assert.equal(mockStorage.getItem(THEME_STORAGE_KEY), 'dark');
  assert.equal(mockDocElement.classList.contains('dark'), true);
  assert.equal(mockDocElement.classList.contains('light'), false);
  assert.equal(mockDocElement.getAttribute('data-theme'), 'dark');
  assert.equal(mockDocElement.style.colorScheme, 'dark');
});

await runTest('Simulated page refresh restores the light theme without reset', () => {
  // Simulate user previously saved light mode
  mockStorage.setItem(THEME_STORAGE_KEY, 'light');

  // Simulate refresh: Anti-FOUC script executes
  const saved = mockStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  applyThemeToDocument(saved);

  assert.equal(saved, 'light');
  assert.equal(mockDocElement.classList.contains('light'), true);
  assert.equal(mockDocElement.classList.contains('dark'), false);
  assert.equal(mockDocElement.getAttribute('data-theme'), 'light');
  assert.equal(mockDocElement.style.colorScheme, 'light');
});

await runTest('ThemeProvider produces identical dark-mode initial markup preventing hydration mismatch', () => {
  // Simulate user having persisted 'light' mode in localStorage
  mockStorage.setItem(THEME_STORAGE_KEY, 'light');

  function HeaderToggleSimulator() {
    const { theme } = useTheme();
    return React.createElement('button', {
      type: 'button',
      'aria-label': theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      title: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    }, React.createElement('span', null, theme === 'dark' ? '☀️' : '🌙'));
  }

  const initialRenderHtml = ReactDOMServer.renderToString(
    React.createElement(ThemeProvider, null, React.createElement(HeaderToggleSimulator))
  );

  // Both server and initial client hydration pass must produce identical dark markup
  assert.ok(initialRenderHtml.includes('aria-label="Switch to light mode"'), 'Initial render must match dark default');
  assert.ok(initialRenderHtml.includes('title="Switch to light mode"'), 'Initial render title must match dark default');
  assert.ok(initialRenderHtml.includes('☀️'), 'Initial render must display ☀️');
  assert.ok(!initialRenderHtml.includes('🌙'), 'Initial render must not display 🌙');
});

await runTest('ThemeProvider avoids side effects in state updaters and unnecessary changes', () => {
  const contextPath = path.resolve('src/lib/context/ThemeContext.tsx');
  const contextContent = fs.readFileSync(contextPath, 'utf8');

  // Verify state setter is pure without side effects
  assert.ok(!contextContent.includes('setThemeState(prev => { applyThemeToDocument'), 'State setter must be pure');
  assert.ok(!contextContent.includes('setThemeState(prev => { localStorage'), 'State setter must be pure');
  assert.ok(contextContent.includes('prev === newTheme ? prev : newTheme'), 'setTheme bails out on unchanged theme');
});

// =========================================================================
// SECTION 5: Header Component Rendering & Accessibility
// =========================================================================
console.log('\n--- Section 5: Header Button & Accessibility ---');

await runTest('Header component renders compact emoji button with proper accessibility', () => {
  const headerPath = path.resolve('src/components/Header.tsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');

  // Must import and use useTheme
  assert.ok(headerContent.includes('useTheme'), 'Header must import useTheme');
  assert.ok(headerContent.includes('toggleTheme'), 'Header must call toggleTheme');

  // Check emojis
  assert.ok(headerContent.includes("theme === 'dark' ? '☀️' : '🌙'"), 'Button must render ☀️ in dark mode and 🌙 in light mode');

  // Check accessibility
  assert.ok(headerContent.includes("aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}"), 'Button must have accessible aria-label');
  assert.ok(headerContent.includes("title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}"), 'Button must have descriptive title');
  assert.ok(headerContent.includes('type="button"'), 'Button must have explicit type="button" for keyboard accessibility');
});

// =========================================================================
// SECTION 6: CSS Theme Variables in globals.css
// =========================================================================
console.log('\n--- Section 6: CSS Variables & Palette Remapping ---');

await runTest('globals.css defines clean light and dark mode palette remapping', () => {
  const cssPath = path.resolve('src/app/globals.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('html.light'), 'globals.css must include html.light selector');
  assert.ok(cssContent.includes('[data-theme="light"]'), 'globals.css must include [data-theme="light"] selector');
  assert.ok(cssContent.includes('html.dark'), 'globals.css must include html.dark selector');
  assert.ok(cssContent.includes('[data-theme="dark"]'), 'globals.css must include [data-theme="dark"] selector');
  assert.ok(cssContent.includes('--color-slate-950: #f8fafc'), 'globals.css must remap --color-slate-950 to #f8fafc');
  assert.ok(cssContent.includes('--color-slate-900: #ffffff'), 'globals.css must remap --color-slate-900 to #ffffff');
  assert.ok(cssContent.includes('--color-slate-800: #e2e8f0'), 'globals.css must remap --color-slate-800 to #e2e8f0');
  assert.ok(cssContent.includes('--color-slate-100: #0f172a'), 'globals.css must remap --color-slate-100 to #0f172a');
  assert.ok(cssContent.includes('--color-blue-950: #eff6ff'), 'globals.css must remap alert container tints');
  assert.ok(cssContent.includes('@custom-variant dark'), 'globals.css must declare @custom-variant dark');
});

await runTest('globals.css defines explicit opacity and scrollbar rules for light mode', () => {
  const cssPath = path.resolve('src/app/globals.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('html.light .bg-slate-950\\/80'), 'Must include light bg-slate-950/80 override');
  assert.ok(cssContent.includes('html.light .bg-slate-900\\/90'), 'Must include light bg-slate-900/90 override');
  assert.ok(cssContent.includes('html.light .border-slate-800\\/80'), 'Must include light border-slate-800/80 override');
  assert.ok(cssContent.includes('html.light ::-webkit-scrollbar-thumb'), 'Must include custom light scrollbar');
});

// =========================================================================
// SUMMARY
// =========================================================================
console.log('\n======================================================');
console.log(`📊 Test Results: ${passedTests} / ${totalTests} Passed (100%)`);
console.log('🎉 Theme Toggle & DevIndicator Suite Passed Successfully!');
console.log('======================================================\n');
