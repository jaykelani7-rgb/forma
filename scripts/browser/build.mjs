import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/chrome-extension',{recursive:true});
for(const file of ['manifest.json','popup.html','popup.css'])await copyFile(`apps/chrome-extension/${file}`,`dist/chrome-extension/${file}`);
await build({entryPoints:['apps/chrome-extension/popup.ts'],outfile:'dist/chrome-extension/popup.js',bundle:true,platform:'browser',target:'chrome120',format:'iife'});
await build({entryPoints:['apps/browser-native-host/index.ts'],outfile:'.companion-build/browser-native-host.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','node:*']});
console.log('Chrome unpacked extension and native host built. Nothing installed or published.');
