import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import hostingConfig from "../.openai/hosting.json";
import { sites } from "./sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_date: "2026-05-22",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    binding: "ASSETS",
    not_found_handling: "single-page-application" as const,
    run_worker_first: true,
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../", import.meta.url)),
    },
  },
  plugins: [
    react(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "server" },
      inspectorPort: false,
      config: localBindingConfig,
    }),
  ],
});
