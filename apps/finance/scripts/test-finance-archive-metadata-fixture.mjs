import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const archive = '/tmp/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz';
const executor = join(repo, 'apps/finance/scripts/finance-production-rollback-first.sh');
const gtar = '/opt/homebrew/bin/gtar';
const expectedArchiveSha256 = 'd8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d';

const digest = spawnSync('/usr/bin/shasum', ['-a', '256', archive], { encoding: 'utf8' });
assert.equal(digest.status, 0, digest.stderr);
assert.match(digest.stdout, new RegExp(`^${expectedArchiveSha256}\\s`));

const ordinary = spawnSync(gtar, ['-tzf', archive], { encoding: 'utf8' });
assert.equal(ordinary.status, 0, ordinary.stderr);
assert.match(ordinary.stderr, /LIBARCHIVE\.xattr\.com\.apple\.provenance/, 'fixture must exercise the archive metadata warning seen by P0272');

const portable = spawnSync(gtar, ['--warning=no-unknown-keyword', '-tzf', archive], { encoding: 'utf8' });
assert.equal(portable.status, 0, portable.stderr);
assert.equal(portable.stderr, '', 'the approved archive must extract/list without warning-only stderr under GNU tar');
assert.match(readFileSync(executor, 'utf8'), /tar --warning=no-unknown-keyword -xzf "\$archive" -C "\$stage"/, 'production executor uses the same GNU tar warning policy');
console.log('finance archive metadata GNU-tar fixture: PASS');
