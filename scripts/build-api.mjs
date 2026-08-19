import { cpSync, mkdirSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const service = resolve(root, "api-service");
const output = resolve(process.env.HEALTHFIELD_API_OUTPUT || resolve(service, "dist"));
const drizzleOutput = resolve(process.env.HEALTHFIELD_API_DRIZZLE_OUTPUT || resolve(service, "drizzle"));
if (relative(service, output).startsWith("..")) throw new Error("HEALTHFIELD_API_OUTPUT must be inside api-service.");
if (relative(service, drizzleOutput).startsWith("..")) throw new Error("HEALTHFIELD_API_DRIZZLE_OUTPUT must be inside api-service.");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

await build({
  entryPoints: {
    server: resolve(service, "src", "server.ts"),
    "register-pull": resolve(service, "src", "register-pull.ts"),
    "register-c2b": resolve(service, "src", "register-c2b.ts"),
  },
  outdir: output,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["sharp"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  sourcemap: true,
  minify: false,
  legalComments: "none",
});

cpSync(resolve(root, "public", "healthfield-logo-clean.png"), resolve(output, "receipt-logo.png"));

rmSync(drizzleOutput, { recursive: true, force: true });
cpSync(resolve(root, "drizzle"), drizzleOutput, { recursive: true });
console.log(`Healthfield API bundle created: ${output}`);
