import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf2json", "pdfkit", "exceljs"],
  outputFileTracingIncludes: {
    "/api/proxy/[...path]": ["./node_modules/pdf2json/dist/**/*"],
  },
};

export default nextConfig;
