import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({ absWorkingDir: fileURLToPath(new URL("..", import.meta.url)), entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], sourcemap: true });
