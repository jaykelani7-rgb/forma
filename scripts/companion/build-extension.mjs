import { build } from 'esbuild';
await build({entryPoints:['apps/vscode-extension/src/extension.ts'],outfile:'apps/vscode-extension/dist/extension.js',bundle:true,platform:'node',format:'cjs',target:'node20',external:['vscode'],logLevel:'info'});
