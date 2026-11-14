#!/usr/bin/env python3
"""Mac source-only directory delta. No cargo, network, client launch or profile access."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', required=True, type=Path)
    p.add_argument('--rustc', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--cached-deps', type=Path, help='Optional original 9cf release/deps, read only')
    a = p.parse_args()
    assert a.source_root.is_absolute() and a.out.is_absolute() and not a.out.exists()
    pins = json.loads((HERE/'source-pin.json').read_text())
    before = {name: sha(a.source_root/name) for name in pins['files']}
    assert before == {name: row['after'] for name, row in pins['files'].items()}
    a.out.mkdir(mode=0o700)
    records = []

    def run(name, command):
        result = subprocess.run([str(v) for v in command], capture_output=True, text=True, timeout=40)
        (a.out/(name+'.stdout')).write_text(result.stdout)
        (a.out/(name+'.stderr')).write_text(result.stderr)
        records.append({'name': name, 'command': [str(v) for v in command], 'exit': result.returncode})
        (a.out/'commands.json').write_text(json.dumps(records, indent=2)+'\n')
        result.check_returncode()

    diagnostics = a.source_root/'clients/socks5/src/commands/directory_diagnostics.rs'
    run('pure-compile', [a.rustc, '--edition=2021', '--test', diagnostics, '-o', a.out/'pure-tests'])
    run('pure-tests', [a.out/'pure-tests'])
    if a.cached_deps:
        # Read exact production fingerprint edges, never mix latest-mtime Tokio reactors.
        fp = a.cached_deps.parent/'.fingerprint'
        original = json.loads((fp/'nym-socks5-client-2d93f5f5e2100c75/bin-nym-socks5-client.json').read_text())

        def find(name, expected):
            matches = [a.cached_deps/('lib'+name+'-'+f.parent.name.rsplit('-', 1)[1]+'.rlib')
                       for f in fp.glob('*/lib-'+name)
                       if int.from_bytes(bytes.fromhex(f.read_text().strip()), 'little') == expected]
            assert len(matches) == 1, name
            return matches[0]

        roots = {x[1]: find(x[1], x[3]) for x in original['deps']
                 if x[1] in ('url', 'tokio', 'serde_json', 'nym_crypto', 'log', 'nym_validator_client')}
        validator = roots.pop('nym_validator_client')
        vr = json.loads((fp/validator.name[3:-5].replace('nym_validator_client', 'nym-validator-client')/'lib-nym_validator_client.json').read_text())
        roots['original_http'] = find('nym_http_api_client', next(x[3] for x in vr['deps'] if x[1] == 'nym_http_api_client'))
        hr = json.loads((fp/roots['original_http'].name[3:-5].replace('nym_http_api_client', 'nym-http-api-client')/'lib-nym_http_api_client.json').read_text())
        for name in ('reqwest', 'tracing'):
            roots[name] = find(name, next(x[3] for x in hr['deps'] if x[1] == name))
        wrapper = ('extern crate self as nym_validator_client;\n'
                   'pub use original_http::{reviewed_policy,reviewed_map,expiry_deadline,tls};\n'
                   '#[path='+json.dumps(str(a.source_root/'common/http-api-client/src/reviewed_network.rs'), ensure_ascii=False)+'] pub mod reviewed_network;\n'
                   '#[path='+json.dumps(str(a.source_root/'clients/socks5/src/commands/reviewed.rs'), ensure_ascii=False)+'] mod reviewed;\n')
        (a.out/'callee.rs').write_text(wrapper)
        base = [a.rustc, '--edition=2021', '-C', 'strip=none', '-C', 'panic=abort', '-L', 'dependency='+str(a.cached_deps)]
        run('actual-callee', base+['--crate-type', 'lib', '--emit=metadata', a.out/'callee.rs', '-o', a.out/'callee.rmeta']+
            [v for name, path in roots.items() for v in ('--extern', name+'='+str(path))])
        source = (HERE/'deadline-controls.rs.in').read_text().replace('@DIAGNOSTICS@', str(diagnostics)).replace('@DEADLINE@', str(a.source_root/'common/http-api-client/src/expiry_deadline.rs'))
        (a.out/'deadline-controls.rs').write_text(source)
        run('deadline-compile', base+['--extern', 'tokio='+str(roots['tokio']), a.out/'deadline-controls.rs', '-o', a.out/'deadline-controls'])
        run('deadline-controls', [a.out/'deadline-controls'])
    after = {name: sha(a.source_root/name) for name in before}
    assert before == after, 'Source changed during check'
    receipt = {'schema': 'YNX_NYM_DIRECTORY_PHASE_DELTA_V1', 'sourceSHA256': before, 'commands': records,
               'pureTests': 4, 'deadlineControls': 4 if a.cached_deps else 'NOT_RUN',
               'networkOrVendorOrProfileRun': False, 'fullCargoBuild': 'NOT_RUN'}
    (a.out/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'receipt': str(a.out/'receipt.json')}))

if __name__ == '__main__':
    main()
