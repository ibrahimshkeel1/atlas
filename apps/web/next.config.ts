import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pdfkit", "exceljs"],
  outputFileTracingIncludes: {
    "/api/proxy/[...path]": ["./node_modules/unpdf/dist/**/*"],
  },
};

export default nextConfig;
