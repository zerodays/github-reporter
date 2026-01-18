import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "..", ".env") });

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname
  }
};

export default nextConfig;
