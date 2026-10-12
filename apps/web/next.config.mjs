/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Version-skew protection: a tab opened before a deploy does a full page load
  // on its next navigation instead of failing to load the old build's files.
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || undefined,
  transpilePackages: ["@cloudivoice/core"],
  serverExternalPackages: ["postgres", "exceljs", "mammoth", "unpdf", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/samples/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};
export default nextConfig;
