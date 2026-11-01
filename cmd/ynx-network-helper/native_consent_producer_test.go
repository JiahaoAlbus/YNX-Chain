package main_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// This compiled Go transport fixture exercises process I/O only. It is not the
// Cocoa visible producer, a person, a production publisher or a UI acceptance.
const nativeTransportFixture = `package main
import("encoding/json";"os";"io";"time";"strings")
func main(){if len(os.Args)!=2||os.Args[1]!="--native-consent"||os.Getenv("HOME")!=""||os.Getenv("PATH")!=""||os.Getenv("YNX_NETWORK_NATIVE_LOCALE")!="ar"||os.Getenv("YNX_NETWORK_NATIVE_THEME")!="dark"{os.Exit(3)};b,_:=io.ReadAll(os.Stdin);var p map[string]string;if json.Unmarshal(b,&p)!=nil{os.Exit(2)};r:=map[string]string{"version":p["version"],"requestId":p["requestId"],"payloadSHA256":p["payloadSHA256"],"decision":"approved"};switch p["generation"]{case "2":r["decision"]="cancelled";case "3":r["requestId"]=strings.Repeat("0",48);case "4":r["payloadSHA256"]=strings.Repeat("0",64);case "5":os.Stderr.WriteString("unexpected");case "6":os.Stdout.WriteString(strings.Repeat("x",4096));return;case "7":time.Sleep(time.Minute);case "8":r["unknown"]="not-allowed"};json.NewEncoder(os.Stdout).Encode(r)}
`

func nativeTransportBinary(t *testing.T) (string, string) {
	t.Helper()
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("fixed native process ownership requires Unix")
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "main.go")
	if err := os.WriteFile(file, []byte(nativeTransportFixture), 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "ynx-network-native-consent")
	cmd := exec.Command(filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-trimpath", "-p", "1", "-o", binary, file)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("transport fixture build: %v %s", err, out)
	}
	raw, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(raw)
	return binary, hex.EncodeToString(h[:])
}
func TestP09NativeConsentProcessTransport(t *testing.T) {
	binary, pin := nativeTransportBinary(t)
	p, err := nativeconsent.New(binary, pin, "ar", "dark")
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	intent := ownednode.Intent{ManagerID: strings.Repeat("1", 48), NodeID: ownednode.NodeID, Action: "start", ArtifactSHA256: strings.Repeat("a", 64), Generation: 1}
	for _, test := range []struct {
		name       string
		generation uint64
		want       error
	}{{"approved-transport-only", 1, nil}, {"cancelled", 2, nativeconsent.ErrCancelled}, {"wrong-challenge", 3, nativeconsent.ErrInvalid}, {"wrong-intent-hash", 4, nativeconsent.ErrInvalid}, {"unexpected-stderr", 5, nativeconsent.ErrInvalid}, {"output-overflow", 6, nativeconsent.ErrInvalid}, {"unknown-response-field", 8, nativeconsent.ErrInvalid}} {
		t.Run(test.name, func(t *testing.T) {
			intent.Generation = test.generation
			err := p.Confirm(context.Background(), intent, "isolated-lifecycle-fixture")
			if !errors.Is(err, test.want) {
				t.Fatalf("transport result %v want %v", err, test.want)
			}
		})
	}
	t.Run("owned-child-deadline", func(t *testing.T) {
		intent.Generation = 7
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer cancel()
		started := time.Now()
		err := p.Confirm(ctx, intent, "isolated-lifecycle-fixture")
		if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 3*time.Second {
			t.Fatalf("owned child deadline: %v %v", err, time.Since(started))
		}
	})
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	if err := p.Confirm(context.Background(), intent, "isolated-lifecycle-fixture"); !errors.Is(err, nativeconsent.ErrUnavailable) {
		t.Fatalf("closed producer reused: %v", err)
	}
	t.Run("fixed-original-byte-binding", func(t *testing.T) {
		q, err := nativeconsent.New(binary, pin, "ar", "dark")
		if err != nil {
			t.Fatal(err)
		}
		defer q.Close()
		raw, err := os.ReadFile(binary)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(binary, binary+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(binary, raw, 0700); err != nil {
			t.Fatal(err)
		}
		intent.Generation = 1
		if err := q.Confirm(context.Background(), intent, "isolated-lifecycle-fixture"); !errors.Is(err, nativeconsent.ErrInvalid) {
			t.Fatalf("same-byte changed inode executed: %v", err)
		}
	})
}
