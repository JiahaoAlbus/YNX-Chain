import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of [
  'index.html',
  'styles.css',
  'workflow.css',
  'wallet-auth.js',
  'i18n.js',
  'privacy-i18n.js',
  'app.js',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'icon-1024.png',
]) {
  await cp(file, `dist/${file}`);
}
await cp('assets', 'dist/assets', { recursive: true });
await cp(
  'release/ynx-shop-0.2.0-testnet-preview.apk',
  'dist/ynx-shop-0.2.0-testnet-preview.apk',
);
console.log('YNX Shop web build: dist/');
