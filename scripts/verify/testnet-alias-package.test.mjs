import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../../deploy/testnet-alias-only/${name}`, import.meta.url), 'utf8');
test('alias-only ingress has two candidate hosts, same loopback authorities and no wider activation', () => {
  for (const file of ['aliases.caddy', 'aliases.nginx.conf']) {
    const text = read(file);
    const hosts = [...new Set(text.match(/[a-z-]+\.ynxweb4\.com/g))].sort();
    assert.deepEqual(hosts, ['faucet-testnet.ynxweb4.com', 'rpc-testnet.ynxweb4.com']);
    assert.match(text, /127\.0\.0\.1:6420/);
    assert.match(text, /127\.0\.0\.1:6428/);
    assert.doesNotMatch(text, /mainnet|explorer|rewrite|redir\s|proxy_redirect/);
  }
});
test('Caddy fixes client identity and does not opt into write retries', () => {
  const text = read('aliases.caddy');
  assert.equal((text.match(/header_up X-Real-IP \{remote_host\}/g) ?? []).length, 2);
  assert.equal((text.match(/lb_retries 0/g) ?? []).length, 2);
  assert.doesNotMatch(text, /trusted_proxies|lb_try_duration|header_up X-Real-IP \{header/);
});
test('nginx disables retries/cache and overwrites caller identity', () => {
  const text = read('aliases.nginx.conf');
  for (const directive of ['proxy_next_upstream off;', 'proxy_cache off;', 'proxy_set_header X-Real-IP $remote_addr;', 'proxy_set_header X-Forwarded-For $remote_addr;']) {
    assert.equal(text.split(directive).length-1, 2);
  }
  assert.equal((text.match(/listen 443 ssl;/g) ?? []).length, 2);
  assert.match(text, /client_max_body_size 16k;/);
  const faucet = text.slice(text.indexOf('server_name faucet-testnet.ynxweb4.com'));
  assert.match(faucet, /proxy_set_header Connection "";/);
  assert.match(faucet, /proxy_socket_keepalive on;/);
});
test('operator package retains external gates and data-preserving rollback', () => {
  const text = read('README.md');
  for (const phrase of ['not deployed', 'never a copied DB', 'nginx -t', 'caddy adapt', 'do not reload', 'No consumers are switched', 'global availability', 'Mainnet is disabled']) assert.ok(text.includes(phrase), phrase);
});
test('legacy and alias Caddy template cannot forward a caller-controlled quota IP', () => {
  const text = readFileSync(new URL('../deploy/deploy-testnet.sh', import.meta.url), 'utf8');
  assert.match(text, /\$\{FAUCET_DOMAIN\}, \$\{TESTNET_FAUCET_DOMAIN\} \{\s+reverse_proxy 127\.0\.0\.1:6428 \{\s+header_up X-Real-IP \{remote_host\}/);
});
