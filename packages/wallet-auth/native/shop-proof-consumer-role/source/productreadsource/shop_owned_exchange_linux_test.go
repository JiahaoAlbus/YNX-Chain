//go:build linux && cgo

package productreadsource

import (
	"crypto/sha256"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Only supplies the existing PUBLIC same-process Unix fixture. Normal client
// expectations come exclusively from the independent reviewed Root literal.
func publicShopOwnedExpected(t *testing.T) securelink.LocalCallerExpectedProcess {
	t.Helper()
	exe, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	exe, e = filepath.EvalSymlinks(exe)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(exe)
	if e != nil || len(raw) == 0 || len(raw) > 128<<20 {
		t.Fatal("PUBLIC image", e)
	}
	stat, e := os.ReadFile("/proc/self/stat")
	if e != nil {
		t.Fatal(e)
	}
	end := strings.LastIndexByte(string(stat), ')')
	if end < 0 {
		t.Fatal("PUBLIC process stat")
	}
	fields := strings.Fields(string(stat[end+1:]))
	if len(fields) < 20 {
		t.Fatal("PUBLIC process stat length")
	}
	start, e := strconv.ParseUint(fields[19], 10, 64)
	if e != nil {
		t.Fatal(e)
	}
	return securelink.LocalCallerExpectedProcess{UID: uint32(os.Geteuid()), PID: os.Getpid(), StartKind: securelink.LocalCallerLinuxProcessStart, StartA: start, ImagePath: exe, ImageBytes: uint64(len(raw)), ImageSHA256: sha256.Sum256(raw)}
}
