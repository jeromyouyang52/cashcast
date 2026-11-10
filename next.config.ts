import type { NextConfig } from "next";

// Bank data stays in the browser. The only server routes are /api/paypal/* (sandbox relay), so connect-src stays 'self'.
const headers = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Dev mode needs eval for fast refresh, so the CSP only ships in production builds.
  ...(process.env.NODE_ENV === "production" ? [{
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
