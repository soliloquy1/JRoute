import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = process.env.NEXT_DIST_DIR || ".build/next";
const projectRoot = dirname(fileURLToPath(import.meta.url));
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

function readTimeoutMs(...values) {
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized == null || normalized === "") continue;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return 600_000;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No basePath: JRoute is deployed at the origin root. The subpath-deployment support
  // came from OmniRoute and depended on scripts/build/normalizeBasePath.mjs, which does
  // not exist on this branch — importing it broke `next build`/`dev`/`start` outright.
  distDir,
  output: "standalone",
  compress: true,
  productionBrowserSourceMaps: false,
  experimental: {
    serverActions: {
      bodySizeLimit: process.env.OMNIROUTE_SERVER_ACTIONS_BODY_LIMIT || "50mb",
    },
    proxyClientMaxBodySize: process.env.NEXT_PROXY_BODY_LIMIT || "512mb",
    proxyTimeout: readTimeoutMs(process.env.REQUEST_TIMEOUT_MS, process.env.FETCH_TIMEOUT_MS),
    optimizePackageImports: ["lucide-react", "date-fns", "lodash", "lodash-es", "next-intl"],
  },
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/*": ["./src/lib/db/migrations/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.git/**/*",
      "./_tasks/**/*",
      "./coverage/**/*",
      "./test-results/**/*",
      "./tests/**/*",
      "./logs/**/*",
    ],
  },
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "thread-stream",
    "pino-abstract-transport",
    "better-sqlite3",
    "keytar",
    "zod",
    "tls-client-node",
    "koffi",
    "ws",
    "bufferutil",
    "utf-8-validate",
    "child_process",
    "fs",
    "path",
    "os",
    "crypto",
    "net",
    "tls",
    "http",
    "https",
    "stream",
    "buffer",
    "util",
    "process",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/chat/completions", destination: "/api/v1/chat/completions" },
      { source: "/models", destination: "/api/v1/models" },
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/v1", destination: "/api/v1" },
    ];
  },
};

export default nextConfig;
