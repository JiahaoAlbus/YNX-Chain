#!/usr/bin/env python3
"""Generate PUBLIC, disposable loopback-only TLS fixtures with system OpenSSL.

Never supply production keys. This generates new random test keys; it does not
reproduce old bytes. Frozen fixture hashes and explicit validity live in the
manifest. CA signing keys and OpenSSL DB are temporary and are not distributed.
The sole output server key is intentionally public and must never be trusted
outside this standalone test APK. No network or third-party Python package.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path,
                    help='New empty directory; never overwrites frozen fixtures')
parser.add_argument('--openssl', default='openssl')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
output = args.output.resolve()
commands = []

with tempfile.TemporaryDirectory(prefix='ynx-public-tls-fixture-') as temporary:
    cwd = Path(temporary)

    def run(*argv):
        commands.append([str(value).replace(str(output), '${OUTPUT_DIR}') for value in argv])
        result = subprocess.run([args.openssl, *argv], cwd=cwd,
                                capture_output=True)
        if result.returncode:
            raise RuntimeError('Public fixture generation failed: ' + result.stderr.decode())
        return result.stdout

    for label in ('trusted', 'untrusted'):
        (cwd / (label + '-index')).write_text('')
        (cwd / (label + '-index.attr')).write_text('unique_subject = no\n')
        (cwd / (label + '-serial')).write_text('1000\n')
        (cwd / (label + '-db')).mkdir()
        ca_config = f'''[ req ]
distinguished_name = dn
x509_extensions = ca_ext
prompt = no
[ dn ]
CN = YNX PUBLIC TEST ONLY {label.upper()} CA
[ ca_ext ]
basicConstraints = critical,CA:true,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[ ca ]
default_ca = local
[ local ]
database = {label}-index
new_certs_dir = {label}-db
serial = {label}-serial
private_key = {label}-ca-key.pem
certificate = {label}-ca.pem
default_md = sha256
policy = names
unique_subject = no
[ names ]
commonName = supplied
'''
        (cwd / (label + '.cnf')).write_text(ca_config)
        # Bootstrap solely to let OpenSSL ca self-sign with explicit dates.
        run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
            '-config', label + '.cnf', '-keyout', label + '-ca-key.pem',
            '-out', label + '-ca.csr')
        run('req', '-x509', '-key', label + '-ca-key.pem', '-in', label + '-ca.csr',
            '-days', '1', '-config', label + '.cnf', '-out', label + '-ca.pem')
        run('ca', '-batch', '-selfsign', '-config', label + '.cnf',
            '-in', label + '-ca.csr', '-out', label + '-ca-final.pem', '-notext',
            '-extensions', 'ca_ext', '-startdate', '20200101000000Z',
            '-enddate', '20360101000000Z')
        (cwd / (label + '-ca.pem')).write_bytes((cwd / (label + '-ca-final.pem')).read_bytes())
        (output / ('qa_tls_' + label + '_ca.pem')).write_bytes((cwd / (label + '-ca.pem')).read_bytes())

    run('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'server-key.pem')
    run('pkcs8', '-topk8', '-nocrypt', '-in', 'server-key.pem', '-outform', 'DER',
        '-out', str(output / 'qa_tls_server_key.der'))
    leaves = [
        ('valid', 'trusted', '127.0.0.1', '20350101000000Z'),
        ('wrong_host', 'trusted', '127.0.0.2', '20350101000000Z'),
        ('expired', 'trusted', '127.0.0.1', '20250101000000Z'),
        ('untrusted', 'untrusted', '127.0.0.1', '20350101000000Z'),
    ]
    for name, ca, ip, not_after in leaves:
        extensions = '''[ leaf ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = IP:''' + ip + '\n'
        (cwd / (name + '-leaf.cnf')).write_text(extensions)
        run('req', '-new', '-key', 'server-key.pem', '-subj',
            '/CN=YNX PUBLIC TEST ONLY ' + name, '-out', name + '.csr')
        run('ca', '-batch', '-config', ca + '.cnf', '-in', name + '.csr',
            '-out', str(output / ('qa_tls_' + name + '.pem')), '-notext',
            '-extfile', name + '-leaf.cnf', '-extensions', 'leaf',
            '-startdate', '20200101000000Z', '-enddate', not_after)

    manifest = {'schema': 'ynx-public-loopback-tls-fixtures-v1',
                'publicTestMaterial': True, 'productionCredentials': False,
                'opensslVersion': run('version').decode().strip(),
                'serverPrivateKeyIntentionallyPublic': 'qa_tls_server_key.der',
                'caPrivateKeysDistributed': False, 'certificates': [], 'files': []}
    for path in sorted(output.glob('*.pem')):
        metadata = run('x509', '-in', str(path), '-noout', '-subject', '-issuer',
                       '-dates', '-serial', '-fingerprint', '-sha256').decode()
        manifest['certificates'].append({'file': path.name, 'metadata': metadata,
                                        'text': run('x509', '-in', str(path), '-noout', '-text').decode()})
    for path in sorted(output.iterdir()):
        manifest['files'].append({'file': path.name, 'bytes': path.stat().st_size,
                                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest['generationArgvWithoutTemporaryPaths'] = commands
    (output / 'public-fixture-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Generated only PUBLIC loopback TLS fixtures in', output)
