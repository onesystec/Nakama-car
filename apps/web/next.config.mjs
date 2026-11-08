// Test copies of the app (Railway PR environments) must talk to their own API, never to the real one.
const PRODUCTION_API_HOST = "nakama-car-production.up.railway.app";

function apiUrl() {
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const configured = process.env.NEXT_PUBLIC_API_URL || "";
  if (!environment || environment === "production") return configured;
  // Railway gives every service the public domain of the others in the same environment.
  const sameEnvironmentApi = process.env.RAILWAY_SERVICE_NAKAMA_CAR_URL;
  const url = sameEnvironmentApi ? `https://${sameEnvironmentApi}/api/v1` : configured;
  if (!url || url.includes(PRODUCTION_API_HOST)) {
    throw new Error(
      `Test environment "${environment}" would use the production API (${url || "empty"}). ` +
        "Set NEXT_PUBLIC_API_URL=https://${{Nakama-car.RAILWAY_PUBLIC_DOMAIN}}/api/v1 on the web service in Railway.",
    );
  }
  return url;
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Security headers on every page. The session token lives in localStorage, so the policy limits where
// scripts come from and where the page may send data (this site and its API only).
function securityHeaders(api) {
  const dev = process.env.NODE_ENV !== "production";
  const apiOrigin = origin(api);
  const csp = [
    "default-src 'self'",
    // Next.js and the login gate use inline scripts; the dev server also needs eval.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiOrigin}`.trim(),
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${apiOrigin}${dev ? " ws: http://localhost:*" : ""}`.trim(),
    // Only this site may show it in a frame (the 3D workshop is a same-site iframe).
    "frame-ancestors 'self'",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  ];
}

const API_URL = apiUrl();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_API_URL: API_URL },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(API_URL) },
      // Pages opened from a secret link: the link must not leak to other sites as a referrer.
      { source: "/segui/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/public/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
