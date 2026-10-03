import {build} from 'esbuild';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of [
  'index.html',
  'styles.css',
  'display-settings.js',
  'workflow.css',
  'wallet-auth.js',
  'browser-business.js',
  'wallet-provider-discovery.js',
  'i18n.js',
  'privacy-i18n.js',
  'request-context.js',
  'checkout-recovery.js',
  'invoice-recovery.js',
  'ai-stream.js',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'icon-1024.png',
]) {
  await cp(file, `dist/${file}`);
}
await cp('assets', 'dist/assets', { recursive: true });
await build({entryPoints:['app.js'],outfile:'dist/app.js',bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],legalComments:'none'});
const bundle=await readFile('dist/app.js','utf8');if(/node:crypto|node:fs|node:path|localhost|127\.0\.0\.1|10\.0\.2\.2/.test(bundle))throw Error('Shop browser bundle retained a forbidden release dependency');
console.log('YNX Shop web build: dist/');
