"""Replace this owned child with the scanner, retaining its stdout privately."""
import os
import stat
import sys

if len(sys.argv) != 3:
    raise SystemExit('expected original scanner and output descriptors')
source = os.environ.get('YNX_PERF_VULN_SOURCE')
if (not source or os.getcwd() != source or os.path.realpath(source) != source
        or any(os.environ.get(k) != v for k, v in dict(GOOS='linux', GOARCH='amd64', CGO_ENABLED='1',
            GOAMD64='v1', GOWORK='off', GOTOOLCHAIN='local', GOFLAGS='-mod=readonly -p=1').items())
        or 'GOVERSION' in os.environ):
    raise SystemExit('original source cwd or target environment differs')
scanner, output = int(sys.argv[1]), int(sys.argv[2])
if scanner < 3 or output < 3 or scanner == output or os.execve not in os.supports_fd:
    raise SystemExit('original scanner/output descriptors unavailable')
scan_info, out_info = os.fstat(scanner), os.fstat(output)
if not stat.S_ISREG(scan_info.st_mode) or not stat.S_ISREG(out_info.st_mode) or out_info.st_size != 0 or out_info.st_nlink != 1:
    raise SystemExit('original scanner/output identity differs')
os.dup2(output, 1)
os.close(output)
os.execve(scanner, ['govulncheck', '-json', '-mode=source', '-scan=symbol', './cmd/ynx-consensus-perf-client'], os.environ)
