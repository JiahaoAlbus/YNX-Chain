#!/usr/bin/env python3
"""Export the frozen original production Go package, not a new crypto module.

The only producer is this local Git-object exporter. Existing CI is a source
reference, never a fabricated producer. No consumer module, key, source policy,
Root, native library or shared working-tree source is modified or instantiated.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import zipfile

REF = 'fdc08527514587d5756264e43ab63588791e189a'
DEPLOYMENT_REF = '928f49a2ad6bc7d087110a550317712ccf7e651d'
HTTP_V5_REF = '8d134c93d3f5500aea01cd0f0f5e88127d4dd37f'
HTTP_V5_GOLDEN = 'internal/ynxbatch/testdata/product-session-proof-v5-public.json'
HTTP_V5_GOLDEN_SHA256 = 'caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d'
SECURELINK_REF = '07101a583caddef5e07b0ddfc0569cc015ae6345'
SECURELINK_PACKAGES = ('internal/securelink', 'internal/securelink/native')
SECURELINK_MODULES = {'golang.org/x/sys': 'v0.48.0'}
MODULE = 'github.com/JiahaoAlbus/YNX-Chain'
PACKAGE = MODULE + '/internal/ynxbatch'
MIN_GO = '1.26.10'
VERSION = 'YNX-CORE-GO-VERIFICATION-SOURCE/v1'
PLATFORMS = (('darwin', 'arm64'), ('linux', 'amd64'), ('windows', 'amd64'))
BOOTSTRAP = ('internal/ynxbatch', 'internal/accountaddress')
EXPECTED_MODULES = {'github.com/cloudflare/circl': 'v1.6.5', 'golang.org/x/crypto': 'v0.57.0',
                    'golang.org/x/net': 'v0.60.0', 'golang.org/x/sys': 'v0.48.0', 'golang.org/x/text': 'v0.42.0'}
PRODUCTION_EXTENSIONS = {'.go', '.s', '.S', '.h', '.c', '.cc', '.cpp', '.m', '.syso'}
LICENSE_PATTERN = re.compile(r'^(?:licen[cs]e|copying|notice|patents|copyright)(?:[._-].*)?$', re.I)


def need(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def pin(raw):
    return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def safe_path(value):
    need(type(value) is str and value and not value.startswith('/') and '\\' not in value
         and not any(part in ('', '.', '..') for part in value.split('/'))
         and all(ord(char) >= 32 and ord(char) != 127 for char in value), 'canonical relative source path required')
    return value


def write_new(root, name, raw):
    path = root / safe_path(name)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as out:
        need(out.write(raw) == len(raw), 'short source write')
        out.flush()
        os.fsync(out.fileno())
    return path


def command(arguments, cwd, env=None, maximum=16 << 20, timeout=180):
    result = subprocess.run(arguments, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            capture_output=True, check=False, timeout=timeout)
    need(len(result.stdout) <= maximum and len(result.stderr) <= maximum, 'bounded source command output required')
    if result.returncode:
        raise RuntimeError('source command failed: ' + ' '.join(arguments[:4]) + '\n' + result.stderr.decode('utf-8', 'replace'))
    return result.stdout


def decode_stream(raw):
    decoder, text, offset, rows = json.JSONDecoder(), raw.decode(), 0, []
    while offset < len(text):
        while offset < len(text) and text[offset].isspace():
            offset += 1
        if offset == len(text):
            break
        row, offset = decoder.raw_decode(text, offset)
        need(type(row) is dict, 'actual go-list package record required')
        rows.append(row)
    need(rows, 'nonempty actual Go dependency list required')
    return rows


def parse_tree(raw):
    result = {}
    for item in raw.split(b'\0'):
        if not item:
            continue
        header, name = item.split(b'\t', 1)
        mode, kind, blob = header.decode().split()
        name = safe_path(name.decode('utf-8'))
        need(name not in result and re.fullmatch('[0-9a-f]{40}', blob), 'unique real Git tree object required')
        result[name] = dict(mode=mode, kind=kind, gitBlob=blob)
    return result


class Snapshot:
    def __init__(self, repository, ref=REF):
        self.repository = repository
        need(ref in (REF, SECURELINK_REF, DEPLOYMENT_REF, HTTP_V5_REF), 'fixed original source profile required')
        self.ref = ref
        self.tree = command(['git', 'rev-parse', ref + '^{tree}'], repository).decode().strip()
        need(command(['git', 'rev-parse', ref + '^{commit}'], repository).decode().strip() == ref, 'exact frozen commit required')
        self.entries = parse_tree(command(['git', 'ls-tree', '-r', '-z', ref], repository, maximum=32 << 20))

    def read(self, name):
        safe_path(name)
        row = self.entries.get(name)
        need(row is not None and row['mode'] in ('100644', '100755') and row['kind'] == 'blob', 'regular frozen Git blob required')
        raw = command(['git', 'show', getattr(self, 'ref', REF) + ':' + name], self.repository)
        need(hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == row['gitBlob'], 'frozen Git blob bytes mismatch')
        return raw

    def production(self, package):
        safe_path(package)
        prefix = package + '/'
        return sorted(name for name in self.entries if name.startswith(prefix) and '/' not in name[len(prefix):]
                      and Path(name).suffix in PRODUCTION_EXTENSIONS and not name.endswith('_test.go')
                      and not Path(name).name.startswith(('.', '_')))


def go_environment(platform=None):
    env = dict(os.environ, GOTOOLCHAIN='auto', GOWORK='off', CGO_ENABLED='0', GOFLAGS='-p=1',
               GOMAXPROCS='2', GOMEMLIMIT='1536MiB', GONOSUMDB='', GOPRIVATE='', GOSUMDB='sum.golang.org')
    if platform:
        env.update(GOOS=platform[0], GOARCH=platform[1])
    else:
        env.pop('GOOS', None)
        env.pop('GOARCH', None)
    return env


def selected_modules(rows):
    modules, local, direct = {}, set(), set()
    for row in rows:
        need(not row.get('Error') and not row.get('DepsErrors'), 'actual dependency resolution failed')
        if row.get('Standard'):
            continue
        module = row.get('Module', {})
        need(module.get('Path') and not module.get('Replace'), 'normal unreplaced module identity required')
        if module['Path'] == MODULE:
            need(row['ImportPath'].startswith(MODULE + '/'), 'original root package path required')
            local.add(row['ImportPath'][len(MODULE) + 1:])
        else:
            path = module['Path']
            need(path in EXPECTED_MODULES and module.get('Version') == EXPECTED_MODULES[path], 'frozen actual dependency version differs')
            modules[path] = {key: module[key] for key in ('Path', 'Version', 'Sum', 'GoModSum', 'GoVersion', 'Dir')}
    for row in rows:
        if row.get('Module', {}).get('Path') == MODULE:
            for imported in row.get('Imports', []):
                candidates = [path for path in modules if imported == path or imported.startswith(path + '/')]
                if candidates:
                    direct.add(max(candidates, key=len))
    need(set(modules) == set(EXPECTED_MODULES) and local == set(BOOTSTRAP), 'complete frozen production package/module closure differs')
    return modules, sorted(local), direct


def sum_fragment(frozen_sum, modules):
    lines = {}
    for line in frozen_sum.decode().splitlines():
        path, version, digest = line.split()
        need((path, version) not in lines, 'duplicate original go.sum pair')
        lines[path, version] = digest
    selected = []
    for path in sorted(modules):
        row = modules[path]
        for version, field in ((row['Version'], 'Sum'), (row['Version'] + '/go.mod', 'GoModSum')):
            need(lines.get((path, version)) == row[field] and re.fullmatch(r'h1:[A-Za-z0-9+/]{43}=', row[field]), 'actual module sum must match frozen go.sum')
            selected.append(path + ' ' + version + ' ' + row[field])
    return ('\n'.join(selected) + '\n').encode()


def require_fragment(modules, direct):
    raw = 'go ' + MIN_GO + '\n\n'
    for indirect in (False, True):
        names = sorted(path for path in modules if (path not in direct) == indirect)
        if names:
            raw += 'require (\n' + ''.join('\t' + path + ' ' + modules[path]['Version'] + (' // indirect' if indirect else '') + '\n' for path in names) + ')\n\n'
    return raw.rstrip().encode() + b'\n'


def module_escape(value):
    return ''.join('!' + char.lower() if 'A' <= char <= 'Z' else char for char in value)


def api_smoke(functions, methods):
    references = '\n'.join('var _ = batch.' + name for name in sorted(functions))
    references += '\n' + '\n'.join('var _ = (*batch.' + receiver + ').' + name for receiver, name in methods)
    return ('''package sourceconsumer
import (
 "testing"
 batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)
''' + references + '''
func TestFrozenPublicVerificationAPI(t *testing.T) {
 if batch.Version != "YNX-BATCH/v0.1" || batch.Suite != "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512" { t.Fatal("fixed protocol changed") }
 if _,err := batch.DecodeMember([]byte{0}); err == nil { t.Fatal("malformed member accepted") }
 if _,err := batch.NewVerifier(batch.VerifierOptions{}); err == nil { t.Fatal("missing expected policy accepted") }
 if _,err := batch.InspectArtifactPublicationMember(nil,batch.ArtifactPublisherRegistration{},nil); err == nil { t.Fatal("missing original accepted") }
 v,err := batch.NewVerifier(batch.VerifierOptions{ChainID:make([]byte,32), Purpose:"SOURCE-API-COMPILE-ONLY", ResolveTrustedOwner:func(batch.TrustRequest)(batch.Registration,error){ return batch.Registration{},batch.ErrUntrusted }})
 if err != nil { t.Fatal(err) }
 defer v.Clear()
 if err := v.VerifyOne([]byte{0},0); err == nil { t.Fatal("malformed member accepted by actual verifier") }
 if _,err := v.AuthenticateCertificate([]byte{0},0); err == nil { t.Fatal("malformed certificate accepted") }
}
''').encode()


def exported_functions(files):
    names = set()
    for raw in files.values():
        names.update(re.findall(rb'^func ([A-Z][A-Za-z0-9_]*)\(', raw, re.M))
    return sorted(name.decode() for name in names)


def exported_methods(files):
    methods = set()
    for raw in files.values():
        for receiver, name in re.findall(rb'^func \((?:[A-Za-z_][A-Za-z0-9_]* )?\*?([A-Z][A-Za-z0-9_]*)\) ([A-Z][A-Za-z0-9_]*)\(', raw, re.M):
            methods.add((receiver.decode(), name.decode()))
    return sorted(methods)


def http_v5_validation(snapshot):
    """Public fixed SDK original used only in isolated consumer validation.

    The public fixture and test are NOT production Source bundle leaves. No
    private material is read or generated, and no signatures are newly created.
    """
    need(snapshot.ref == HTTP_V5_REF, 'HTTP V5 exact source required')
    golden = snapshot.read(HTTP_V5_GOLDEN)
    need(hashlib.sha256(golden).hexdigest() == HTTP_V5_GOLDEN_SHA256, 'HTTP V5 final-path SDK original differs')
    smoke = r'''package sourceconsumer
import (
 "bytes"
 "crypto/sha256"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "os"
 "testing"
 batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)
// Compile the actual typed production signatures, not a wrapper or substitute.
var _ func([]byte,[]byte,string,batch.ProductSessionHTTPBinding)([]byte,error) = batch.BuildProductSessionHTTPV5Message
var _ func([]byte,batch.ProductSessionHTTPBinding)(batch.ProductSessionHTTPMessage,error) = batch.InspectProductSessionHTTPV5Message
var _ func([]byte,batch.ProductSessionHTTPBinding,[]byte)(batch.ProductSessionHTTPMessage,error) = batch.InspectProductSessionHTTPV5Member
func TestFrozenHTTPV5PublicOriginal(t *testing.T) {
 raw,err:=os.ReadFile("http-v5-golden.json");if err!=nil{t.Fatal(err)}
 sum:=sha256.Sum256(raw)
 if hex.EncodeToString(sum[:])!="caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d"{t.Fatal("original public fixture changed")}
 var g struct{UnsignedCanonicalJSON,BodyBase64url,ContentType,NetworkID,PKA,PKB,MessageBase64url,MemberBase64url string;Unsigned struct{CanonicalOwner string}}
 if err=json.Unmarshal(raw,&g);err!=nil{t.Fatal(err)}
 h:=func(s string)[]byte{b,e:=hex.DecodeString(s);if e!=nil{t.Fatal(e)};return b}
 b64:=func(s string)[]byte{b,e:=base64.RawURLEncoding.DecodeString(s);if e!=nil{t.Fatal(e)};return b}
 binding:=batch.ProductSessionHTTPBinding{NetworkID:h(g.NetworkID),Owner:g.Unsigned.CanonicalOwner,PKA:h(g.PKA),PKB:h(g.PKB)}
 body,member:=b64(g.BodyBase64url),b64(g.MemberBase64url)
 message,err:=batch.BuildProductSessionHTTPV5Message([]byte(g.UnsignedCanonicalJSON),body,g.ContentType,binding)
 if err!=nil||!bytes.Equal(message,b64(g.MessageBase64url)){t.Fatalf("actual body/E6 binding failed: %v",err)}
 if len(body)!=267||len(message)!=1532||len(member)!=59159{t.Fatal("fixed full-path original lengths differ")}
 inspected,err:=batch.InspectProductSessionHTTPV5Message(message,binding)
 if err!=nil||!bytes.Equal(inspected.UnsignedOriginal,[]byte(g.UnsignedCanonicalJSON)){t.Fatalf("typed E6 rejected: %v",err)}
 if _,err=batch.InspectProductSessionHTTPV5Member(member,binding,message);err!=nil{t.Fatalf("actual dual AND rejected: %v",err)}
 for _,branch:=range []string{"A","B"}{
  m,e:=batch.DecodeMember(member);if e!=nil{t.Fatal(e)}
  if branch=="A"{m.Certificate.SigmaA[0]^=1}else{m.Certificate.SigmaB[0]^=1}
  bad,e:=batch.EncodeMember(m);if e!=nil{t.Fatal(e)}
  if _,e=batch.InspectProductSessionHTTPV5Member(bad,binding,message);e==nil{t.Fatal("bad AND branch accepted",branch)}
 }
 changed:=bytes.Clone(body);changed[len(changed)-1]^=1
 if _,err=batch.BuildProductSessionHTTPV5Message([]byte(g.UnsignedCanonicalJSON),changed,g.ContentType,binding);err==nil{t.Fatal("wrong captured body accepted")}
 if _,err=batch.BuildProductSessionHTTPV5Message([]byte(g.UnsignedCanonicalJSON),body,g.ContentType+"x",binding);err==nil{t.Fatal("wrong captured content type accepted")}
 wrong:=binding;wrong.PKB=bytes.Clone(binding.PKB);wrong.PKB[0]^=1
 if _,err=batch.InspectProductSessionHTTPV5Member(member,wrong,message);err==nil{t.Fatal("independent full pair ignored")}
}
'''.encode()
    contract = dict(version='YNX-CORE-HTTP-V5-SOURCE-API/v1', package=PACKAGE, sourceCommit=HTTP_V5_REF,
                    profile='http-v5', method='POST', path='/api/v1/ide/deployments',
                    importRule='Keep the original module/import identity. Go internal visibility requires the original root module or a descendant module under github.com/JiahaoAlbus/YNX-Chain/. No package rewrite or relative replace.',
                    purpose='PRODUCT-SESSION-HTTP-PROOF', messageDomain='YNX-PRODUCT-SESSION-HTTP-PROOF/v5',
                    bindingType='ProductSessionHTTPBinding{NetworkID []byte, Owner string, PKA []byte, PKB []byte}',
                    bindingWidths=dict(NetworkID=32, Owner=42, PKA=2592, PKB=64),
                    publicAPIs=[
                        dict(function='BuildProductSessionHTTPV5Message', signature='func(unsignedOriginal, actualBody []byte, actualContentType string, binding ProductSessionHTTPBinding) ([]byte, error)',
                             checks='Exact canonical unsigned23; actual complete immutable binary body SHA256/SHA3-512/SHA512, length and actual content type; fixed E6 with original shared E3.'),
                        dict(function='InspectProductSessionHTTPV5Message', signature='func(message []byte, binding ProductSessionHTTPBinding) (ProductSessionHTTPMessage, error)',
                             checks='Typed E6 and tuple consistency only; has no actual body input. Compare to independently built original.'),
                        dict(function='InspectProductSessionHTTPV5Member', signature='func(member []byte, binding ProductSessionHTTPBinding, expectedMessage []byte) (ProductSessionHTTPMessage, error)',
                             checks='Exact original E6, N1/index0/empty paths, purpose/network/owner/full pair, both roots and both real signatures.')],
                    limits=dict(bodyBytes=68288512, messageBytes=16384, memberBytes=98304),
                    inputsImmutableDuringCall=True, resultOriginalsDetached=True,
                    independentBindingRequired=True, actualBodyRequiredBeforeMemberUse=True,
                    publicOriginalValidation=dict(repositoryPath=HTTP_V5_GOLDEN, sha256=HTTP_V5_GOLDEN_SHA256,
                        shippedInProductionSource=False, originalSDKSignatureVerified=True,
                        bothSignatureMutationsRejected=True, newlyCreatedSignatures=False),
                    grants=dict(Source=False, Root=False, currentRegistration=False, native=False, userApproval=False,
                                clock=False, durableOnce=False, HTTPExecution=False),
                    boundary='DATA math only. Auth/Main must supply original registered identity, source/current/revocation, clock, scope, approval and durable once. No V4 downgrade.')
    return smoke, golden, contract


def math_ci_reference(source_ref):
    # A pending run is not validation evidence. HTTP V5's independently executed
    # source consumers are recorded below; do not borrow another profile's CI.
    if source_ref == HTTP_V5_REF:
        return None
    if source_ref == REF:
        return dict(runId='41196019511', url='https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/41196019511',
                    commit=REF, referenceOnly=True, producerOfThisBundle=False)
    need(source_ref == DEPLOYMENT_REF, 'fixed math source profile required')
    return dict(runId='41204973224', url='https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/41204973224',
                commit=DEPLOYMENT_REF, componentJobs=[124548097153, 124548097114],
                componentConclusion='success', wholeRunConclusion='failure',
                scope='fixed E11 V2 native and independent Go codec/AND component only',
                referenceOnly=True, producerOfThisBundle=False)


def export(repository, output, source_ref=REF):
    need(repository.is_absolute() and repository.resolve(strict=True) == repository, 'canonical original repository required')
    need(output.is_absolute() and output.parent.resolve(strict=True) == output.parent and not output.exists() and not output.is_symlink(),
         'fresh absolute source output required; retain existing/UNKNOWN')
    need(source_ref in (REF, DEPLOYMENT_REF, HTTP_V5_REF), 'fixed math source profile required')
    snapshot = Snapshot(repository, source_ref)
    work = Path(tempfile.mkdtemp(prefix='core-verification-work-http-v5-' if source_ref == HTTP_V5_REF else 'core-verification-work-fdc-', dir=output.parent))
    probe = work / 'frozen-probe'
    probe.mkdir(mode=0o700)
    initial = sorted({name for package in BOOTSTRAP for name in snapshot.production(package)})
    for name in initial + ['go.mod', 'go.sum', 'third_party/cometbft/go.mod', 'third_party/cometbft/go.sum']:
        write_new(probe, name, snapshot.read(name))
    # The Comet go.mod/sum above are original graph metadata only, not a
    # supplied/compiled dependency or a substituted crypto implementation.
    need(re.search(rb'^module ' + re.escape(MODULE.encode()) + rb'\s*$', snapshot.read('go.mod'), re.M)
         and re.search(rb'^go 1\.26\.10\s*$', snapshot.read('go.mod'), re.M), 'original root module and minimum Go required')
    graphs, module_set, local, direct, package_files = {}, None, None, set(), set()
    for platform in PLATFORMS:
        env = go_environment(platform)
        raw = command(['go', 'list', '-mod=readonly', '-deps', '-json', './internal/ynxbatch'], probe, env=env)
        rows = decode_stream(raw)
        modules, packages, direct_on_target = selected_modules(rows)
        comparable = {path: {key: row[key] for key in ('Path', 'Version', 'Sum', 'GoModSum', 'GoVersion')} for path, row in modules.items()}
        if module_set is None:
            module_set, local, module_dirs = comparable, packages, {path: Path(row['Dir']) for path, row in modules.items()}
        need(module_set == comparable and local == packages, 'target-dependent module selections differ')
        direct |= direct_on_target
        description = []
        for row in rows:
            if row.get('Standard'):
                continue
            entry = dict(importPath=row['ImportPath'], module=row['Module']['Path'], version=row['Module'].get('Version'),
                         files={key: row.get(key, []) for key in ('GoFiles', 'CgoFiles', 'SFiles', 'HFiles', 'EmbedFiles')})
            description.append(entry)
            if row['Module']['Path'] == MODULE:
                package = row['ImportPath'][len(MODULE) + 1:]
                package_files.update(snapshot.production(package))
                for key in ('GoFiles', 'CgoFiles', 'SFiles', 'HFiles', 'CFiles', 'CXXFiles', 'MFiles', 'SysoFiles', 'EmbedFiles'):
                    for name in row.get(key, []):
                        package_files.add(safe_path(package + '/' + name))
        graphs['/'.join(platform)] = description
    files = {name: snapshot.read(name) for name in sorted(package_files)}
    need(set(files) == set(initial), 'frozen full production package contains an unbootstrapped dependency')
    modules = {path: dict(row) for path, row in module_set.items()}
    requires = require_fragment(modules, direct)
    sums = sum_fragment(snapshot.read('go.sum'), modules)
    minimum = work / 'minimal-original-root'
    minimum.mkdir(mode=0o700)
    minimal_mod = b'module ' + MODULE.encode() + b'\n\n' + requires
    for name, raw in files.items():
        write_new(minimum, name, raw)
    write_new(minimum, 'go.mod', minimal_mod)
    write_new(minimum, 'go.sum', sums)
    functions = exported_functions({name: raw for name, raw in files.items() if name.startswith('internal/ynxbatch/')})
    methods = exported_methods({name: raw for name, raw in files.items() if name.startswith('internal/ynxbatch/')})
    smoke = api_smoke(functions, methods)
    write_new(minimum, 'sourceconsumer/api_test.go', smoke)
    http_validation = None
    if source_ref == HTTP_V5_REF:
        need({'BuildProductSessionHTTPV5Message', 'InspectProductSessionHTTPV5Message', 'InspectProductSessionHTTPV5Member'} <= set(functions), 'actual HTTP V5 production API closure missing')
        http_validation = http_v5_validation(snapshot)
        write_new(minimum, 'sourceconsumer/http_v5_api_test.go', http_validation[0])
        write_new(minimum, 'sourceconsumer/http-v5-golden.json', http_validation[1])
    env = go_environment()
    go_version = command(['go', 'env', 'GOVERSION'], minimum, env=env).decode().strip()
    need(go_version == 'go' + MIN_GO, 'original cached Go1.26.10 producer required')
    logs = {}
    logs['modulesVerified'] = command(['go', 'mod', 'verify'], minimum, env=env).decode().strip()
    before_graph = {name: pin((minimum / name).read_bytes()) for name in ('go.mod', 'go.sum')}
    logs['sameNameRootAPI'] = command(['go', 'test', '-mod=readonly', '-p', '1', './sourceconsumer', '-count=1'], minimum, env=env).decode().strip()
    need(before_graph == {name: pin((minimum / name).read_bytes()) for name in before_graph}, 'minimal root graph changed')
    selected = selected_modules(decode_stream(command(['go', 'list', '-mod=readonly', '-deps', '-json', './internal/ynxbatch'], minimum, env=env)))[0]
    need({path: row['Version'] for path, row in selected.items()} == EXPECTED_MODULES, 'minimal graph changed frozen selected versions')
    # A real local file module proxy exercises normal module resolution and
    # internal visibility, without a relative replace, module alias or rewrite.
    seconds = int(command(['git', 'show', '-s', '--format=%ct', source_ref], repository))
    stamp = datetime.fromtimestamp(seconds, timezone.utc)
    module_version = 'v0.0.0-' + stamp.strftime('%Y%m%d%H%M%S') + '-' + source_ref[:12]
    proxy = work / 'normal-file-proxy'
    version_dir = proxy / module_escape(MODULE) / '@v'
    version_dir.mkdir(mode=0o700, parents=True)
    write_new(version_dir, module_version + '.mod', minimal_mod)
    write_new(version_dir, module_version + '.info', encoded(dict(Version=module_version, Time=stamp.isoformat().replace('+00:00', 'Z'))))
    archive = version_dir / (module_version + '.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as out:
        for name, raw in sorted({**files, 'go.mod': minimal_mod, 'go.sum': sums}.items()):
            info = zipfile.ZipInfo(MODULE + '@' + module_version + '/' + name, (1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, raw)
    consumer = work / 'normal-submodule-consumer'
    consumer.mkdir(mode=0o700)
    write_new(consumer, 'go.mod', ('module ' + MODULE + '/source-verification-consumer\n\ngo ' + MIN_GO + '\n\nrequire ' + MODULE + ' ' + module_version + '\n').encode())
    write_new(consumer, 'api_test.go', smoke)
    if http_validation is not None:
        write_new(consumer, 'http_v5_api_test.go', http_validation[0])
        write_new(consumer, 'http-v5-golden.json', http_validation[1])
    consumer_env = dict(env, GOPROXY=proxy.as_uri() + ',' + os.environ.get('GOPROXY', 'https://proxy.golang.org,direct'),
                        GONOSUMDB=MODULE)
    command(['go', 'mod', 'tidy'], consumer, env=consumer_env)
    need(b'replace ' not in (consumer / 'go.mod').read_bytes(), 'normal submodule must not use replace')
    consumer_before = {name: pin((consumer / name).read_bytes()) for name in ('go.mod', 'go.sum')}
    logs['normalSubmoduleAPI'] = command(['go', 'test', '-mod=readonly', '-p', '1', './...', '-count=1'], consumer, env=consumer_env).decode().strip()
    need(consumer_before == {name: pin((consumer / name).read_bytes()) for name in consumer_before}, 'normal consumer graph changed during readonly compile/API')
    consumer_rows = decode_stream(command(['go', 'list', '-mod=readonly', '-deps', '-json', PACKAGE], consumer, env=consumer_env))
    consumer_selected = selected_modules(consumer_rows)[0]
    need({path: row['Version'] for path, row in consumer_selected.items()} == EXPECTED_MODULES, 'normal submodule changed frozen dependency versions')
    output.mkdir(mode=0o700)
    for name, raw in files.items():
        write_new(output, 'source/' + name, raw)
    carried = {'source/' + name: dict(**pin(raw), gitBlob=snapshot.entries[name]['gitBlob'], kind='frozen-original-git-production-source', repositoryPath=name)
               for name, raw in files.items()}
    # Dependencies are normal pinned modules, not forked/vendor crypto. Keep
    # every existing upstream root license/notice/patent without inventing a
    # root license that does not exist in the selected original Git snapshot.
    licensing = []
    for path, directory in sorted(module_dirs.items()):
        selected_licenses = sorted(child for child in directory.iterdir() if LICENSE_PATTERN.fullmatch(child.name))
        need(selected_licenses, 'original external module license missing')
        for original in selected_licenses:
            need(original.is_file() and not original.is_symlink(), 'regular original module license required')
            raw = original.read_bytes()
            name = 'licenses/' + path + '@' + modules[path]['Version'] + '/' + original.name
            write_new(output, name, raw)
            carried[name] = dict(**pin(raw), gitBlob=None, kind='original-sum-verified-upstream-module-license',
                                 module=path, version=modules[path]['Version'], moduleSum=modules[path]['Sum'])
            licensing.append(name)
    generated = {
        'requirements/go.require.fragment': requires, 'requirements/go.sum.fragment': sums,
        'requirements/modules.json': encoded([dict(row, direct=path in direct) for path, row in sorted(modules.items())]),
        'validation/PACKAGE-CLOSURE.json': encoded(graphs),
        'validation/PUBLIC-API.json': encoded(dict(package=PACKAGE, exportedFunctionNames=functions,
                                                 exportedMethods=[dict(receiver=receiver, name=name) for receiver, name in methods], generationFunctionsInvoked=False)),
        'validation/CONSUMERS.json': encoded(dict(goVersion=go_version, results=logs, sameNameRootGraph=before_graph,
                                               submoduleGraph=consumer_before, relativeReplaceUsed=False,
                                               localFileProxyForTestOnly=True, testModuleVersion=module_version,
                                               privateKeyInstancesCreated=False, NISTOrSignatureSuiteRepeated=False)),
    }
    if http_validation is not None:
        generated['validation/HTTP-V5-API.json'] = encoded(http_validation[2])
    for name, raw in generated.items():
        write_new(output, name, raw)
        carried[name] = dict(**pin(raw), gitBlob=None, kind='locally-derived-source-closure-metadata')
    root_license_names = [name for name in snapshot.entries if LICENSE_PATTERN.fullmatch(PurePosixPath(name).name)
                          and str(PurePosixPath(name).parent) in ('.', 'internal', *BOOTSTRAP)]
    for name in root_license_names:
        raw = snapshot.read(name)
        target = 'source/' + name
        write_new(output, target, raw)
        carried[target] = dict(**pin(raw), gitBlob=snapshot.entries[name]['gitBlob'], kind='frozen-original-root-package-license', repositoryPath=name)
    for name, row in carried.items():
        need(pin((output / name).read_bytes()) == {key: row[key] for key in ('bytes', 'sha256')}, 'source supply readback differs')
    actual = {str(path.relative_to(output)) for path in output.rglob('*') if path.is_file()}
    need(actual == set(carried), 'closed complete source supply required')
    implementation = Path(__file__).resolve(strict=True)
    source = dict(version=VERSION, classification='original-public-production-math-source', sourceCommit=source_ref, sourceTree=snapshot.tree,
                  rootModule=MODULE, package=PACKAGE, minimumGo=MIN_GO, productionPackages=local, productionSourceLeafCount=len(files),
                  files=carried, directExternalModules=sorted(direct), externalModules=modules,
                  normalModuleRequirementsFile='requirements/go.require.fragment', exactSumAdditionsFile='requirements/go.sum.fragment',
                  originalRootGoMod=dict(**pin(snapshot.read('go.mod')), gitBlob=snapshot.entries['go.mod']['gitBlob']),
                  originalRootGoSum=dict(**pin(snapshot.read('go.sum')), gitBlob=snapshot.entries['go.sum']['gitBlob']),
                  rootLicenseFiles=root_license_names, rootLicenseFound=bool(root_license_names), originalUpstreamLicenseFiles=licensing,
                  producer=dict(kind='local-frozen-git-object-source-export', githubCIProducer=False,
                                implementation=dict(path='scripts/ops/export-core-verification-source.py', **pin(implementation.read_bytes()))),
                  validatedSourceCIReference=math_ci_reference(source_ref),
                  verification=dict(sameNameRootAPICompiledAndChecked=True, normalSubmoduleAPICompiledAndChecked=True,
                                    externalModuleChecksumsVerified=True, relativeReplaceUsed=False, actualDependencyPlatforms=['/'.join(p) for p in PLATFORMS],
                                    workspace=str(work), privateKeyInstancesCreated=False, cryptographicKnownAnswerSuiteRepeated=False),
                  containsOriginalKeyGenCode=True, privateMaterialIncluded=False, consumerModuleModified=False,
                  SDKInstallerOwnsConsumerGraph=True, SourceAdmission=False, RootAdmission=False, nativeGrant=False,
                  policy='Full original production package, not a new crypto module. SDK merges minimum requirements/sums; source does not grant current/Root/approval.')
    if http_validation is not None:
        source.update(sourceProfile='http-v5', typedAPIContractFile='validation/HTTP-V5-API.json')
        source['verification'].update(actualHTTPV5PublicOriginalANDVerified=True, publicFixtureShipped=False,
                                      newSignaturesCreated=False, sameNameRootAndSubmoduleHTTPV5Calls=True)
    write_new(output, 'SOURCE.json', encoded(source))
    fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    print(json.dumps(dict(path=str(output), source=pin((output / 'SOURCE.json').read_bytes()), files=len(carried), productionSources=len(files),
                          rootAPI=logs['sameNameRootAPI'], normalSubmoduleAPI=logs['normalSubmoduleAPI'], RootAdmission=False), sort_keys=True))


def securelink_selection(rows):
    modules, local, direct = {}, set(), set()
    for row in rows:
        need(not row.get('Error') and not row.get('DepsErrors'), 'securelink actual dependency resolution failed')
        if row.get('Standard'):
            continue
        module = row.get('Module', {})
        need(module.get('Path') and not module.get('Replace'), 'securelink normal unreplaced module required')
        if module['Path'] == MODULE:
            need(row['ImportPath'].startswith(MODULE + '/'), 'original securelink import required')
            local.add(row['ImportPath'][len(MODULE) + 1:])
        else:
            path = module['Path']
            need(path in SECURELINK_MODULES and module.get('Version') == SECURELINK_MODULES[path], 'securelink frozen external version differs')
            modules[path] = {key: module[key] for key in ('Path', 'Version', 'Sum', 'GoModSum', 'GoVersion', 'Dir')}
    need(local == set(SECURELINK_PACKAGES), 'full securelink/native package closure required')
    for row in rows:
        if row.get('Module', {}).get('Path') == MODULE:
            direct.update(path for path in modules for imported in row.get('Imports', [])
                          if imported == path or imported.startswith(path + '/'))
    return modules, direct


def securelink_smoke(files):
    catalog, references = {}, []
    for package, alias in zip(SECURELINK_PACKAGES, ('link', 'native')):
        selected = {name: raw for name, raw in files.items() if str(PurePosixPath(name).parent) == package}
        functions, methods = exported_functions(selected), exported_methods(selected)
        catalog[package] = dict(functions=functions, methods=[dict(receiver=receiver, name=name) for receiver, name in methods])
        references += ['var _ = ' + alias + '.' + name for name in functions]
        references += ['var _ = (*' + alias + '.' + receiver + ').' + name for receiver, name in methods]
    common = ('''package sourceconsumer
import (
 "errors"
 "strings"
 "testing"
 "time"
 link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
 native "github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)
''' + '\n'.join(references) + '''
func TestFrozenSecurelinkTypedAPI(t *testing.T) {
 if link.Group != "SecP384r1MLKEM1024" || link.Cipher != "TLS_AES_256_GCM_SHA384" || link.MediaProfileShopOrderReadV1 != "shop-order-read-v1" { t.Fatal("fixed typed contract changed") }
 if _,err:=link.NewFixedPeerClient(link.FixedPeerClientConfig{}); !errors.Is(err,link.ErrUnavailable) { t.Fatal("missing profile accepted",err) }
 if _,err:=link.ServiceChannelFromRequest(nil); !errors.Is(err,link.ErrDenied) { t.Fatal("missing actual channel accepted",err) }
 p:=link.FixedPeerProfile{ID:"source-api", Revision:"1",Service:"source-api",EdgeID:"edge",LocalSAN:"client.test",PeerSAN:"server.test",Origin:"https://server.test",Address:"127.0.0.1:9443",Epoch:1,
 Roots:[]link.Root{{Fingerprint:strings.Repeat("a",64),Until:time.Now().Add(time.Hour)}},Operations:[]link.ServiceOperation{{ID:"shop.order.read",Method:"POST",Path:"/api/tools/shop.order.read",MaxRequestBytes:1<<20,MaxResponseBytes:1<<20,MediaProfile:link.MediaProfileShopOrderReadV1}}}
 cfg:=link.FixedPeerClientConfig{Profile:p,TLS:native.Config{PeerSAN:p.PeerSAN}}
 if _,err:=link.NewFixedPeerClient(cfg); !errors.Is(err,link.ErrUnavailable) { t.Fatal("missing original credentials did not fail unavailable",err) }
 for _,kind:=range []string{"unknown-media","wrong-operation","oversize"} {
   c:=cfg; c.Profile.Operations=append([]link.ServiceOperation(nil),p.Operations...)
   switch kind {case "unknown-media":c.Profile.Operations[0].MediaProfile="caller-chosen";case "wrong-operation":c.Profile.Operations[0].ID="other";case "oversize":c.Profile.Operations[0].MaxRequestBytes=(1<<20)+1}
   if _,err:=link.NewFixedPeerClient(c);!errors.Is(err,link.ErrDenied){t.Fatal(kind,"changed finite media contract",err)}
 }
}
''').encode()
    unavailable = b'''//go:build !securelink_openssl || !cgo
package sourceconsumer
import("errors";"testing";native "github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native")
func TestFrozenSecurelinkUnavailableContract(t *testing.T){if _,err:=native.NewContext(native.Config{});!errors.Is(err,native.ErrUnavailable){t.Fatal("stub admitted native TLS",err)}}
'''
    native = b'''//go:build securelink_openssl && cgo
package sourceconsumer
import("testing";native "github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native")
func TestFrozenSecurelinkNativeAPIOnly(t *testing.T){if _,err:=native.NewContext(native.Config{});err==nil{t.Fatal("missing original credentials accepted")}}
'''
    return {'api_test.go': common, 'unavailable_test.go': unavailable, 'native_test.go': native}, catalog


def securelink_native_environment():
    """Reuse the original installed runtime; never download/build OpenSSL."""
    prefix = Path('/opt/homebrew/Cellar/openssl@3/3.6.4')
    runtime = Path('/Users/huangjiahao/.codex/worktrees/v5-link-transport/YNX Chain/cmd/ynx-secure-link/runtime-macos-arm64.json')
    if os.uname().sysname != 'Darwin' or os.uname().machine != 'arm64' or not prefix.is_dir() or not runtime.is_file():
        return None, dict(available=False, actualNativeAPICompile=False, actualTLSRerun=False,
                          reason='original pinned darwin/arm64 OpenSSL3.6.4 runtime not available')
    expected = {'lib/libssl.3.dylib': 'ebee4a51513f22f6efc6d3b9ff9d638015d2d924c0e443b31df2735798cb8dcb',
                'lib/libcrypto.3.dylib': '380d32d4d229136f9ded004906634491c8d416779d031abadc3d6463b1ef8e3d',
                'LICENSE.txt': '7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a',
                'lib/pkgconfig/openssl.pc': 'c9d52c66850d576bcfa89207e699d02e25fb4e9f1c277f2b9c67c6970cd02ae6',
                'lib/pkgconfig/libssl.pc': 'dcce5c71265440153027f645df730a0cfc118bf1856114cf4803125cfac29177',
                'lib/pkgconfig/libcrypto.pc': 'd739245e36d0ccc75cbec478555460bc0c1dd3a08d3b29c8164b1aa8c63ef878',
                'include/openssl/opensslv.h': 'c1941c5dbb9aabf9c02105918290918c1ba457f7c50e89ff7defa11431b58575'}
    records = {}
    for name in (*expected, 'include/openssl/opensslv.h', 'lib/pkgconfig/openssl.pc', 'lib/pkgconfig/libssl.pc', 'lib/pkgconfig/libcrypto.pc'):
        path = prefix / name
        raw = path.read_bytes()
        if name in expected:
            need(hashlib.sha256(raw).hexdigest() == expected[name], 'original native runtime/license pin differs')
        records[name] = dict(path=str(path), resolvedPath=str(path.resolve(strict=True)), **pin(raw))
    need(pin(runtime.read_bytes()) == dict(bytes=700, sha256='5aa479de42b047e83d05296a9d644772dfb05c43a22f61d58de2ab38f9605765'), 'original runtime manifest bytes differ')
    manifest = json.loads(runtime.read_bytes())
    need(manifest['opensslVersion'] == '3.6.4' and manifest['platform'] == 'darwin/arm64'
         and {Path(row['path']).name: row['sha256'] for row in manifest['libraries']} ==
         {Path(name).name: digest for name, digest in expected.items() if name.endswith('.dylib')}, 'original native runtime manifest differs')
    header_files = {}
    for path in sorted((prefix / 'include').rglob('*')):
        need(not path.is_symlink(), 'original OpenSSL header symlink refused')
        if path.is_file():
            header_files[str(path.relative_to(prefix))] = pin(path.read_bytes())
    header_manifest = ''.join(row['sha256'] + ' ' + str(row['bytes']) + ' ' + name + '\n' for name, row in sorted(header_files.items())).encode()
    need(len(header_files) == 142 and pin(header_manifest) == dict(bytes=13511, sha256='53ee187c284a0129dbfbb1763bc662a2ca024cee71cead8273740f03d9918c2d'), 'complete original OpenSSL header closure differs')
    header = (prefix / 'include/openssl/opensslv.h').read_bytes()
    for name, value in (('MAJOR', '3'), ('MINOR', '6'), ('PATCH', '4')):
        need(re.search(rb'#\s*define OPENSSL_VERSION_' + name.encode() + rb'\s+' + value.encode() + rb'\s*$', header, re.M), 'fixed OpenSSL headers differ')
    env = dict(go_environment(), CGO_ENABLED='1', PKG_CONFIG_PATH=str(prefix / 'lib/pkgconfig'), PKG_CONFIG_LIBDIR=str(prefix / 'lib/pkgconfig'))
    for key in ('CGO_CFLAGS', 'CGO_CPPFLAGS', 'CGO_CXXFLAGS', 'CGO_LDFLAGS', 'CGO_CFLAGS_ALLOW', 'CGO_LDFLAGS_ALLOW', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH', 'PKG_CONFIG', 'OPENSSL_CONF', 'OPENSSL_MODULES'):
        env.pop(key, None)
    env.update(PKG_CONFIG='/opt/homebrew/bin/pkg-config', CC='/usr/bin/clang')
    need(command([env['PKG_CONFIG'], '--modversion', 'openssl'], prefix, env).strip() == b'3.6.4', 'actual pkg-config version differs')
    flags = command([env['PKG_CONFIG'], '--cflags', '--libs', 'openssl'], prefix, env).decode().split()
    need(set(flags) == {'-I' + str(prefix / 'include'), '-L' + str(prefix / 'lib'), '-lssl', '-lcrypto'}, 'actual pinned native compiler flags differ')
    return env, dict(available=True, platform='darwin/arm64', originalRuntimeManifest=dict(path=str(runtime), **pin(runtime.read_bytes())),
                     files=records, headerFiles=header_files, headerManifest=pin(header_manifest),
                     actualNativeAPICompile=False, actualTLSRerun=False, runtimeRebuilt=False, credentialsCreated=False)


def export_securelink(repository, output):
    need(repository.is_absolute() and repository.resolve(strict=True) == repository, 'canonical original repository required')
    need(output.is_absolute() and output.parent.resolve(strict=True) == output.parent and not output.exists() and not output.is_symlink(), 'fresh securelink source output required; retain existing/UNKNOWN')
    snapshot = Snapshot(repository, SECURELINK_REF)
    work = Path(tempfile.mkdtemp(prefix='core-securelink-work-071-', dir=output.parent))
    probe = work / 'frozen-probe'
    probe.mkdir(mode=0o700)
    files = {name: snapshot.read(name) for package in SECURELINK_PACKAGES for name in snapshot.production(package)}
    for name, raw in files.items():
        write_new(probe, name, raw)
    for name in ('go.mod', 'go.sum', 'third_party/cometbft/go.mod', 'third_party/cometbft/go.sum'):
        write_new(probe, name, snapshot.read(name))
    need(re.search(rb'^go 1\.26\.10\s*$', snapshot.read('go.mod'), re.M), 'original securelink minimum Go required')
    modules, direct, graphs = {}, set(), {}
    for platform in PLATFORMS:
        rows = decode_stream(command(['go', 'list', '-mod=readonly', '-deps', '-json', './internal/securelink/...'], probe, go_environment(platform)))
        selected, target_direct = securelink_selection(rows)
        direct |= target_direct
        for path, row in selected.items():
            need(path not in modules or modules[path] == row, 'securelink target module selection differs')
            modules[path] = row
        graphs['/'.join(platform) + '/cgo0'] = [dict(importPath=row['ImportPath'], module=row['Module']['Path'], version=row['Module'].get('Version'),
              files={key: row.get(key, []) for key in ('GoFiles', 'CgoFiles', 'CFiles', 'HFiles', 'SFiles', 'EmbedFiles', 'IgnoredGoFiles')}) for row in rows if not row.get('Standard')]
    need({path: row['Version'] for path, row in modules.items()} == SECURELINK_MODULES, 'full securelink external module closure differs')
    requirements, sums = require_fragment(modules, direct), sum_fragment(snapshot.read('go.sum'), modules)
    minimal_mod = b'module ' + MODULE.encode() + b'\n\n' + requirements
    minimum = work / 'minimal-original-root'
    minimum.mkdir(mode=0o700)
    for name, raw in {**files, 'go.mod': minimal_mod, 'go.sum': sums}.items():
        write_new(minimum, name, raw)
    smoke, api_catalog = securelink_smoke(files)
    for name, raw in smoke.items():
        write_new(minimum, 'sourceconsumer/' + name, raw)
    env = go_environment()
    need(command(['go', 'env', 'GOVERSION'], minimum, env).strip() == b'go1.26.10', 'original exact Go1.26.10 required')
    logs = dict(moduleChecksums=command(['go', 'mod', 'verify'], minimum, env).decode().strip())
    before = {name: pin((minimum / name).read_bytes()) for name in ('go.mod', 'go.sum')}
    logs['defaultCGO0API'] = command(['go', 'test', '-mod=readonly', '-p', '1', './sourceconsumer', '-count=1'], minimum, env).decode().strip()
    logs['taggedCGO0Unavailable'] = command(['go', 'test', '-mod=readonly', '-p', '1', '-tags', 'securelink_openssl', './sourceconsumer', '-count=1'], minimum, env).decode().strip()
    native_env, native_record = securelink_native_environment()
    if native_env is not None:
        tagged = decode_stream(command(['go', 'list', '-mod=readonly', '-tags', 'securelink_openssl', '-deps', '-json', './internal/securelink/...'], minimum, native_env))
        selected, _ = securelink_selection(tagged)
        need({path: row['Version'] for path, row in selected.items()} == SECURELINK_MODULES, 'actual tagged native module closure differs')
        native_row = next(row for row in tagged if row['ImportPath'] == MODULE + '/internal/securelink/native')
        need(native_row.get('CgoFiles') == ['openssl.go'] and native_row.get('CFiles') == ['bridge.c'] and native_row.get('HFiles') == ['bridge.h'], 'actual tagged native source selection differs')
        graphs['darwin/arm64/cgo1/securelink_openssl'] = {key: native_row.get(key, []) for key in ('GoFiles', 'CgoFiles', 'CFiles', 'HFiles', 'CgoPkgConfig', 'Imports')}
        logs['nativeCGO1APIOnly'] = command(['go', 'test', '-mod=readonly', '-p', '1', '-tags', 'securelink_openssl', './sourceconsumer', '-count=1'], minimum, native_env).decode().strip()
        native_record['actualNativeAPICompile'] = True
    need(before == {name: pin((minimum / name).read_bytes()) for name in before}, 'securelink root graph changed')
    seconds = int(command(['git', 'show', '-s', '--format=%ct', SECURELINK_REF], repository))
    stamp = datetime.fromtimestamp(seconds, timezone.utc)
    version = 'v0.0.0-' + stamp.strftime('%Y%m%d%H%M%S') + '-' + SECURELINK_REF[:12]
    proxy = work / 'normal-file-proxy'
    version_dir = proxy / module_escape(MODULE) / '@v'
    version_dir.mkdir(mode=0o700, parents=True)
    write_new(version_dir, version + '.mod', minimal_mod)
    write_new(version_dir, version + '.info', encoded(dict(Version=version, Time=stamp.isoformat().replace('+00:00', 'Z'))))
    with zipfile.ZipFile(version_dir / (version + '.zip'), 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted({**files, 'go.mod': minimal_mod, 'go.sum': sums}.items()):
            info = zipfile.ZipInfo(MODULE + '@' + version + '/' + name, (1980, 1, 1, 0, 0, 0))
            info.external_attr, info.compress_type = 0o100644 << 16, zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    consumer = work / 'normal-submodule-consumer'
    consumer.mkdir(mode=0o700)
    write_new(consumer, 'go.mod', ('module ' + MODULE + '/securelink-source-consumer\n\ngo ' + MIN_GO + '\n\nrequire ' + MODULE + ' ' + version + '\n').encode())
    for name, raw in smoke.items():
        write_new(consumer, name, raw)
    consumer_env = dict(env, GOPROXY=proxy.as_uri() + ',' + os.environ.get('GOPROXY', 'https://proxy.golang.org,direct'), GONOSUMDB=MODULE)
    command(['go', 'mod', 'tidy'], consumer, consumer_env)
    need(b'replace ' not in (consumer / 'go.mod').read_bytes(), 'securelink normal consumer must not use replace')
    consumer_before = {name: pin((consumer / name).read_bytes()) for name in ('go.mod', 'go.sum')}
    logs['normalSubmoduleCGO0API'] = command(['go', 'test', '-mod=readonly', '-p', '1', './...', '-count=1'], consumer, consumer_env).decode().strip()
    if native_env is not None:
        consumer_native_env = dict(native_env, GOPROXY=consumer_env['GOPROXY'], GONOSUMDB=MODULE)
        logs['normalSubmoduleNativeAPIOnly'] = command(['go', 'test', '-mod=readonly', '-p', '1', '-tags', 'securelink_openssl', './...', '-count=1'], consumer, consumer_native_env).decode().strip()
    need(consumer_before == {name: pin((consumer / name).read_bytes()) for name in consumer_before}, 'securelink normal consumer graph changed')
    native_equal = {}
    for prior in ('3b39b57ca18935feb0ecf7c0b51c40f31afb820d', 'd6a5075bf17c7a8e4751ba290f749fe2661325f4', 'f98789710f92d8954b93d2ebfbde6c01d29d8e0f'):
        native_equal[prior] = {}
        for name in files:
            if name.startswith('internal/securelink/native/'):
                blob = command(['git', 'rev-parse', prior + ':' + name], repository).decode().strip()
                need(blob == snapshot.entries[name]['gitBlob'], 'native prerequisite blob differs from original qualified LINK source')
                native_equal[prior][name] = blob
    if native_env is not None:
        for row in native_record['files'].values():
            need(pin(Path(row['path']).read_bytes()) == {key: row[key] for key in ('bytes', 'sha256')}, 'original native runtime changed during API build')
        for name, row in native_record['headerFiles'].items():
            need(pin((Path('/opt/homebrew/Cellar/openssl@3/3.6.4') / name).read_bytes()) == row, 'original native header changed during API build')
    output.mkdir(mode=0o700)
    carried = {}
    for name in (*files, 'internal/securelink/PROTECTED_CALLER.md', 'internal/securelink/native/README.md'):
        raw = files.get(name) if name in files else snapshot.read(name)
        target = 'source/' + name
        write_new(output, target, raw)
        carried[target] = dict(**pin(raw), gitBlob=snapshot.entries[name]['gitBlob'], repositoryPath=name,
                               kind='frozen-original-git-production-source' if name in files else 'frozen-original-git-integration-contract')
    for path, row in sorted(modules.items()):
        for leaf in ('LICENSE', 'PATENTS'):
            raw = (Path(row['Dir']) / leaf).read_bytes()
            target = 'licenses/' + path + '@' + row['Version'] + '/' + leaf
            write_new(output, target, raw)
            carried[target] = dict(**pin(raw), gitBlob=None, kind='original-sum-verified-upstream-module-license', module=path, moduleSum=row['Sum'])
    if native_env is not None:
        raw = Path(native_record['files']['LICENSE.txt']['path']).read_bytes()
        target = 'licenses/openssl-3.6.4/LICENSE.txt'
        write_new(output, target, raw)
        carried[target] = dict(**pin(raw), gitBlob=None, kind='original-pinned-native-runtime-license', license='Apache-2.0')
    generated = {'requirements/go.require.fragment': requirements, 'requirements/go.sum.fragment': sums,
                 'requirements/modules.json': encoded([{key: value for key, value in row.items() if key != 'Dir'} for _, row in sorted(modules.items())]),
                 'validation/PACKAGE-CLOSURE.json': encoded(graphs), 'validation/PUBLIC-API.json': encoded(api_catalog),
                 'validation/CONSUMERS.json': encoded(dict(goVersion=MIN_GO, results=logs, rootGraph=before, submoduleGraph=consumer_before,
                   relativeReplaceUsed=False, localFileProxyForTestOnly=True, testModuleVersion=version, actualTLSRerun=False, credentialsCreated=False)),
                 'requirements/NATIVE-RUNTIME.json': encoded(dict(buildTag='securelink_openssl', CGO_ENABLED='1', pkgConfig='openssl',
                   openssl='3.6.4', TLS='TLSv1.3', group='SecP384r1MLKEM1024', cipher='TLS_AES_256_GCM_SHA384', signature='mldsa87',
                   allChainCertificates='ML-DSA-87 public keys AND signatures including root', provider='default in private process-lifetime context',
                   sourceURL='https://github.com/openssl/openssl/releases/download/openssl-3.6.4/openssl-3.6.4.tar.gz',
                   sourceSHA256='9bffaa1ad1e07b354c21bd3324ec02fa15579f45a7d0494b3e74bc449b7333ef',
                   defaultCGO0='ErrUnavailable; no TLS fallback', observed=native_record)),
                 'validation/ORIGINAL-NATIVE-EVIDENCE.json': encoded(dict(sourceBlobEquality=native_equal,
                   ownerCurrent='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/CURRENT.json',
                   originalVerification='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/VERIFICATION.json',
                   latestMediaEvidence='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/media-profile-07101a583',
                   evidenceReused=True, thisExporterRanTLS=False, currentHostedCIClaim=False))}
    for name, raw in generated.items():
        write_new(output, name, raw)
        carried[name] = dict(**pin(raw), gitBlob=None, kind='locally-derived-source-closure-metadata')
    for name, row in carried.items():
        need(pin((output / name).read_bytes()) == {key: row[key] for key in ('bytes', 'sha256')}, 'securelink source readback differs')
    need({str(path.relative_to(output)) for path in output.rglob('*') if path.is_file()} == set(carried), 'closed securelink source catalog required')
    original_modules = {path: {key: value for key, value in row.items() if key != 'Dir'} for path, row in modules.items()}
    source = dict(version='YNX-CORE-SECURELINK-SOURCE/v1', classification='original-production-transport-source',
                  sourceCommit=SECURELINK_REF, sourceTree=snapshot.tree, rootModule=MODULE, minimumGo=MIN_GO,
                  productionPackages=list(SECURELINK_PACKAGES), productionSourceLeafCount=len(files), files=carried,
                  directExternalModules=sorted(direct), externalModules=original_modules,
                  originalRootGoMod=dict(**pin(snapshot.read('go.mod')), gitBlob=snapshot.entries['go.mod']['gitBlob']),
                  originalRootGoSum=dict(**pin(snapshot.read('go.sum')), gitBlob=snapshot.entries['go.sum']['gitBlob']),
                  normalModuleRequirementsFile='requirements/go.require.fragment', exactSumAdditionsFile='requirements/go.sum.fragment',
                  rootLicenseFound=False, rootLicenseReason='No root or included-package LICENSE/COPYING/NOTICE in original fixed Git source; no Comet license substituted.',
                  producer=dict(kind='local-frozen-git-object-source-export', githubCIProducer=False,
                    implementation=dict(path='scripts/ops/export-core-verification-source.py', **pin(Path(__file__).read_bytes()))),
                  verification=dict(workspace=str(work), results=logs, actualNativeAPICompile=native_record['actualNativeAPICompile'],
                    actualTLSRerun=False, originalNativeBlobEqualityVerified=True, sourceAdmission=False, RootAdmission=False,
                    consumerModuleModified=False, relativeReplaceUsed=False, credentialsCreated=False),
                  SDKInstallerOwnsConsumerGraph=True, installation=False, deployment=False,
                  policy='Original securelink package; no new crypto module. Default and CGO0 tagged fail unavailable. TLS transport is not Source/Root authority.')
    write_new(output, 'SOURCE.json', encoded(source))
    print(json.dumps(dict(path=str(output), source=pin((output / 'SOURCE.json').read_bytes()), productionSources=len(files),
                          files=len(carried), results=logs, actualTLSRerun=False, RootAdmission=False), sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--repository', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--profile', choices=('ynxbatch', 'securelink', 'deployment-v2', 'http-v5'), default='ynxbatch')
    args = parser.parse_args()
    if args.profile == 'securelink':
        export_securelink(args.repository, args.output)
    else:
        export(args.repository, args.output, {'ynxbatch': REF, 'deployment-v2': DEPLOYMENT_REF, 'http-v5': HTTP_V5_REF}[args.profile])


if __name__ == '__main__':
    main()
