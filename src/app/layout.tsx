import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "JRoute",
};

/**
 * Sets the theme class before first paint so there is no flash of the wrong theme.
 * Persisted choice (localStorage "jroute-theme") wins; otherwise follow the OS.
 * Static string only — never interpolate anything into this script.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("jroute-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      // The inline theme script mutates this element's class before hydration —
      // suppress the expected className mismatch warning.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
