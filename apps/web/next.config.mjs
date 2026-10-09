/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

export default {
  reactStrictMode: true,
  poweredByHeader: false,
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
