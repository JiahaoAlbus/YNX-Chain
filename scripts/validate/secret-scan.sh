#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
scanner_path='scripts/validate/secret-scan.sh'
scaffold_path='tools/scaffold-ynx-chain.mjs'
public_tls_fixture_path='third_party/cometbft/rpc/jsonrpc/server/test.key'
public_tls_fixture_sha256='2b95a96284cc502dba1d4c30dd6c7c6dad465c9a062d32afd2fafd7a093e808e'
public_http_v5_fixture_path='internal/ynxbatch/testdata/product-session-proof-v5-public.json'
public_http_v5_fixture_sha256='caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d'
public_account_source_fixture_path='internal/consensus/testdata/account_auth_interop/auth-public-fixture/public/current.original'

# Preserve the status of git itself. Process substitution would otherwise hide
# a failed inventory as an empty, apparently successful scan.
umask 077
file_list=$(mktemp "${TMPDIR:-/tmp}/ynx-secret-scan.XXXXXX")
trap 'rm -f -- "$file_list"' EXIT
if git ls-files --cached --others --exclude-standard -z -- . >"$file_list"; then
  :
else
  status=$?
  echo "secret scan could not complete: file inventory failed" >&2
  exit "$status"
fi

verify_public_tls_fixture() {
  local path=$1 digest
  # This is the existing public upstream TLS test fixture, not a key class or
  # directory exclusion. A changed fixture is refused even without a header.
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "public TLS fixture identity mismatch" >&2
    return 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum -- "$path") || {
      echo "public TLS fixture digest could not be read" >&2
      return 2
    }
  else
    digest=$(shasum -a 256 -- "$path") || {
      echo "public TLS fixture digest could not be read" >&2
      return 2
    }
  fi
  if [[ ${digest%% *} != "$public_tls_fixture_sha256" ]]; then
    echo "public TLS fixture identity mismatch" >&2
    return 2
  fi
}

public_http_v5_metadata() {
  local metadata parent
  # Recheck aliases after hashing as well as before it: renaming the original
  # into a symlink target can preserve the target's inode and public digest.
  for parent in internal internal/ynxbatch internal/ynxbatch/testdata; do
    [[ -d "$parent" && ! -L "$parent" ]] || return 2
  done
  [[ -f "$1" && ! -L "$1" ]] || return 2
  if metadata=$(stat -c '%d:%i:%h:%a:%s:%Y:%Z' -- "$1" 2>/dev/null); then
    printf '%s\n' "$metadata"
    return
  fi
  if metadata=$(stat -f '%d:%i:%l:%Lp:%z:%m:%c' -- "$1" 2>/dev/null); then
    printf '%s\n' "$metadata"
    return
  fi
  return 2
}

verify_public_http_v5_fixture() {
  local path=$1 parent before after digest
  # Fixed public SDK vector: Member encodes public descriptors, two signatures,
  # message and proofs, never private material. Its exact bytes are also pinned
  # by product_session_http_v5_test.go. No token regex or directory is excluded.
  for parent in internal internal/ynxbatch internal/ynxbatch/testdata; do
    if [[ ! -d "$parent" || -L "$parent" ]]; then
      echo "public HTTP V5 fixture identity mismatch" >&2
      return 2
    fi
  done
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
    return 2
  fi
  before=$(public_http_v5_metadata "$path") || {
    echo "public HTTP V5 fixture metadata could not be read" >&2
    return 2
  }
  # The ordinary Git checkout is 0644; private regression copies use 0600.
  # Refuse executable/mutated modes and hardlink aliases, including equal bytes.
  if [[ ! "$before" =~ ^[0-9]+:[0-9]+:1:(600|644):356971:[0-9]+:[0-9]+$ ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
    return 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum -- "$path") || {
      echo "public HTTP V5 fixture digest could not be read" >&2
      return 2
    }
  else
    digest=$(shasum -a 256 -- "$path") || {
      echo "public HTTP V5 fixture digest could not be read" >&2
      return 2
    }
  fi
  after=$(public_http_v5_metadata "$path") || {
    echo "public HTTP V5 fixture metadata could not be read" >&2
    return 2
  }
  if [[ "$before" != "$after" || ${digest%% *} != "$public_http_v5_fixture_sha256" ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
    return 2
  fi
}

verify_public_account_source_fixture() {
  # One original Auth Source-v2 PUBLIC vector. The token-shaped bytes are in
  # its SLH signature, not a credential. Original MobileSourceMath.cpp feeds
  # this exact member to YNXAuthSourceStatementVerifyV2 (ML-DSA AND SLH, N=1).
  # This recognizer admits only the pinned public encoding, never new proofs,
  # authority, another .original file, or a caller's "PUBLIC" assertion.
  if python3 - "$1" <<'PY_ACCOUNT_PUBLIC'
import base64, hashlib, json, os, pathlib, stat, struct, sys

def require(ok):
    if not ok:
        raise ValueError('fixed PUBLIC encoding differs')

def identity(s):
    return (s.st_dev, s.st_ino, s.st_nlink, s.st_mode, s.st_uid,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def parents(p):
    result = []
    for parent in reversed(p.parents):
        if parent == pathlib.Path('.'):
            continue
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode))
        result.append((str(parent), s.st_dev, s.st_ino))
    return result

def decode(value):
    require(isinstance(value, str) and '=' not in value)
    result = base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
    require(base64.urlsafe_b64encode(result).rstrip(b'=').decode() == value)
    return result

def fields(b, count):
    require(len(b) >= 4 and struct.unpack_from('>I', b)[0] == count)
    offset, result = 4, []
    for _ in range(count):
        require(offset + 4 <= len(b))
        size = struct.unpack_from('>I', b, offset)[0]
        offset += 4
        require(offset + size <= len(b))
        result.append(b[offset:offset + size])
        offset += size
    require(offset == len(b))
    return result

fd = None
try:
    p = pathlib.Path(sys.argv[1])
    require(str(p) == 'internal/consensus/testdata/account_auth_interop/auth-public-fixture/public/current.original')
    ancestors = parents(p)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    before = os.fstat(fd)
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.geteuid())
    require(stat.S_IMODE(before.st_mode) in (0o600, 0o644) and before.st_size == 79013)
    with os.fdopen(fd, 'rb', closefd=False) as source:
        raw = source.read(79014)
    require(len(raw) == 79013 and hashlib.sha256(raw).hexdigest() == '4262e0e7f8d0d9751b73d8a28565dd7ef2bd3e344e94d557ad82b5597970d867')
    value = json.loads(raw)
    require(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode() == raw)
    require(set(value) == {'algorithmVersion', 'body', 'executionHeight', 'keyVersion', 'member', 'networkId', 'owner', 'role', 'version'})
    require(value['version'] == 2 and value['algorithmVersion'] == 'YNX-BATCH/v0.1' and value['role'] == 'current')
    member = fields(decode(value['member']), 4)
    require(member[0] == b'YNX-BATCH/v0.1/MEMBER')
    certificate = fields(member[1], 3)
    require(len(certificate[1]) == 4627 and len(certificate[2]) == 49856)
    descriptor = fields(certificate[0], 5)
    require(descriptor[0] == b'YNX-BATCH/v0.1/DESCRIPTOR' and descriptor[2] == b'\0\0\0\1')
    require(len(descriptor[3]) == 64 and len(descriptor[4]) == 64)
    context = fields(descriptor[1], 8)
    require(context[0] == b'YNX-BATCH/v0.1/CONTEXT')
    require(context[1] == b'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512')
    require(context[2] == bytes.fromhex(value['networkId']) and len(context[2]) == 32)
    require(context[3] == value['owner'].encode() and len(context[3]) == 42)
    require(len(context[4]) == 2592 and len(context[5]) == 64 and len(context[6]) == 16)
    require(context[7] == b'AUTH-SOURCE-CURRENT')
    message = fields(member[2], 8)
    require(message[0] == b'YNX/AUTH/SOURCE-ORIGINAL/V2' and message[1] == b'current')
    require(message[2] == b'PUBLIC-MOBILE-CURRENT' and message[3] == value['networkId'].encode())
    require(message[4] == value['owner'].encode() and message[5] == value['keyVersion'].encode())
    require(message[6] == value['executionHeight'].encode() and message[7] == decode(value['body']))
    proof = fields(member[3], 3)
    require(proof[0] == b'\0\0\0\0' and fields(proof[1], 0) == [] and fields(proof[2], 0) == [])
    require(identity(before) == identity(os.fstat(fd)) == identity(p.lstat()))
    require(parents(p) == ancestors)
except Exception:
    print('public Auth current fixture identity or public structure mismatch', file=sys.stderr)
    sys.exit(2)
finally:
    if fd is not None:
        os.close(fd)
PY_ACCOUNT_PUBLIC
  then
    return 0
  else
    echo 'public Auth current fixture verification could not complete' >&2
    return 2
  fi
}

scan_file() {
  local path=$1
  if command -v rg >/dev/null 2>&1; then
    rg -n --with-filename --no-messages -e "$pattern" -- "$path"
    return
  fi
  grep -HInE --binary-files=without-match -e "$pattern" -- "$path"
}

scan() {
  local path status found=1
  while IFS= read -r -d '' path; do
    case "$path" in
      "$scanner_path"|"$scaffold_path") continue ;;
      "$public_tls_fixture_path")
        verify_public_tls_fixture "$path"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
      "$public_account_source_fixture_path")
        verify_public_account_source_fixture "$path"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
      "$public_http_v5_fixture_path")
        verify_public_http_v5_fixture "$path"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
    esac
    scan_file "$path"
    status=$?
    case "$status" in
      0) found=0 ;;
      1) ;;
      *) return "$status" ;;
    esac
  done <"$file_list"
  return "$found"
}

set +e
scan
status=$?
set -e
case "$status" in
  0)
    echo "possible secret found"
    exit 1
    ;;
  1)
    echo "secret scan passed"
    ;;
  *)
    echo "secret scan could not complete" >&2
    exit "$status"
    ;;
esac
