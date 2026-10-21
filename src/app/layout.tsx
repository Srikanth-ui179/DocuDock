import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import 'katex/dist/katex.min.css';
import { ProviderKeyProvider } from '@/lib/context/ProviderKeyContext';
import { ThemeProvider } from '@/lib/context/ThemeContext';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'DocuDock — AI Document Research Assistant',
  description: 'Grounded AI document research assistant with page-level citations and zero-host-cost architecture.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100 selection:bg-blue-500/30">
        <Script
          id="docudock-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){
              try {
                var t = localStorage.getItem('docudock_theme') || 'dark';
                var d = document.documentElement;
                if (t === 'light') {
                  d.classList.remove('dark');
                  d.classList.add('light');
                  d.setAttribute('data-theme', 'light');
                  d.style.colorScheme = 'light';
                } else {
                  d.classList.remove('light');
                  d.classList.add('dark');
                  d.setAttribute('data-theme', 'dark');
                  d.style.colorScheme = 'dark';
                }
              } catch(e) {}
            })();`,
          }}
        />
        <ThemeProvider>
          <ProviderKeyProvider>{children}</ProviderKeyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
