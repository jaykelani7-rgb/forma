import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=process.cwd();
await mkdir('.companion-build',{recursive:true});
await mkdir('.companion-build/assets',{recursive:true});
await copyFile('packages/pet-ui/assets/fenn-tray.png','.companion-build/assets/fenn-tray.png');
await Promise.all([
  ...['index','database-worker'].map(name=>build({entryPoints:[`apps/desktop/main/${name}.ts`],outfile:`.companion-build/${name==='index'?'main':name}.cjs`,bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','node:*'],logLevel:'warning'})),
  build({entryPoints:['apps/desktop/preload/index.ts'],outfile:'.companion-build/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node24'}),
  buildRenderer({configFile:resolve(root,'apps/desktop/vite.config.mjs')}),
]);
const htmlPath='.companion-build/renderer/index.html';
await writeFile(htmlPath,(await readFile(htmlPath,'utf8')).replace("connect-src 'self' ws://localhost:* ws://127.0.0.1:*", "connect-src 'none'"));
await writeFile('.companion-build/package.json',JSON.stringify({name:'forma-companion',productName:'Forma Companion',version:'0.1.0',private:true,main:'main.cjs',description:'A quiet local practice companion for Forma',author:'Forma contributors'},null,2));
console.log('Forma Companion local development build is ready.');
