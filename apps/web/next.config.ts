import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pdfkit", "exceljs"],
};

export default nextConfig;
