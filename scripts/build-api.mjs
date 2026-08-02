import { cpSync, mkdirSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const service = resolve(root, "api-service");
const output = resolve(process.env.HEALTHFIELD_API_OUTPUT || resolve(service, "dist"));
if (relative(service, output).startsWith("..")) throw new Error("HEALTHFIELD_API_OUTPUT must be inside api-service.");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

await build({
  entryPoints: [resolve(service, "src", "server.ts")],
  outfile: resolve(output, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  sourcemap: true,
  minify: false,
  legalComments: "none",
});

rmSync(resolve(service, "drizzle"), { recursive: true, force: true });
cpSync(resolve(root, "drizzle"), resolve(service, "drizzle"), { recursive: true });
console.log(`Healthfield API bundle created: ${output}`);
