import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// CSP. Notes on the choices:
//   - connect-src is just 'self'. OpenAI is called server-side from
//     lib/ai/assistant.ts, so the browser never talks to api.openai.com.
//   - script-src drops 'unsafe-eval' in production. Next.js dev HMR needs
//     it; production builds do not.
//   - 'unsafe-inline' on style-src is the realistic concession for Next's
//     runtime style injection. Inline-script nonces would be the next
//     tightening step but require runtime wiring; deferred.
//   - frame-ancestors 'none' is the CSP equivalent of X-Frame-Options
//     DENY (X-Frame-Options is also sent for legacy UAs).
const cspDirectives = [
  "default-src 'self'",
  isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

const sharedHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()"
    ].join(", ")
  }
];

// HSTS only in production. Sending it on http://localhost would pin the
// dev origin to HTTPS in the browser cache and break local development.
const productionOnlyHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains"
  }
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: isProduction ? [...sharedHeaders, ...productionOnlyHeaders] : sharedHeaders
      }
    ];
  }
};

export default nextConfig;
