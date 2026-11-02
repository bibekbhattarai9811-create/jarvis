/** @type {import('next').NextConfig} */
export default {
  // NEXT_DIST lets a second dev server (plain http, for testing) run beside the main one.
  distDir: process.env.NEXT_DIST || ".next",
  // Hide the dev "issues" badge: MediaPipe logs harmless INFO lines through console.error.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Only Jarvis's own pages may frame it (the glasses simulator frames /hud): no clickjacking.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      // API answers are private: never cached by the browser or anything in between.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};
