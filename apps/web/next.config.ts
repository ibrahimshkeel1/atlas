import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf2json", "pdfkit", "exceljs"],
  outputFileTracingIncludes: {
    "/api/proxy/[...path]": ["./node_modules/pdf2json/dist/**/*"],
    "/api/**/*": ["./node_modules/pdf2json/dist/**/*"],
  },
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  },
};

export default nextConfig;
