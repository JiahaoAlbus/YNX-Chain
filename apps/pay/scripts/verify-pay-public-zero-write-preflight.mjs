import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./pay-public-zero-write-preflight.sh', import.meta.url));
const source = await readFile(script, 'utf8');

const required = [
  'sudo caddy adapt --config /etc/caddy/Caddyfile',
  'sudo cat /etc/caddy/ynx-chain.caddy',
  'sudo cat /etc/caddy/conf.d/ynx-pay-app.caddy',
  'sudo cat /etc/caddy/conf.d/ynx-merchant-console.caddy',
  'sudo test ! -e /opt/ynx-pay-web',
  'sudo systemctl show ynx-payd.service',
  'sudo ss -H -lntp',
  'remote_capture caddy-adapt.json',
  'PAY_KNOWN_HOSTS',
  'ssh-keygen -lf',
];
for (const token of required) {
  if (!source.includes(token)) throw new Error(`missing zero-write preflight contract: ${token}`);
}

const array = source.match(/remote_commands=\(\n([\s\S]*?)\n\)/)?.[1];
if (!array) throw new Error('remote command allowlist is not statically discoverable');
for (const forbidden of [
  /\bmktemp\b/,
  /\b(?:tee|touch|mkdir|rm|cp|mv|install|tar)\b/,
  /\bsystemctl\s+(?:restart|reload|start|stop|enable|disable)\b/,
  /\bcaddy\s+reload\b/,
  />/,
]) {
  if (forbidden.test(array)) throw new Error(`remote command allowlist contains prohibited write primitive: ${forbidden}`);
}
if (!/"\$\{ssh_base\[@\]\}" "\$command" >"\$output_dir\/\$filename"/.test(source)) {
  throw new Error('remote stdout is not captured directly by the local shell');
}
console.log('pay-public-zero-write-preflight: remote command allowlist is read-only and all captures are local');
