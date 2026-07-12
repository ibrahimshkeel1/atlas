import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfkit", "exceljs"],
};

export default nextConfig;
