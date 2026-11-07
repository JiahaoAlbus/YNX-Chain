// Test-only Native-owned overlay reusing original P09 process/identity helpers.
package current4transport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// One new actual normal Native startup/backend entry control. Its profile and
// Auth Source boundary are PUBLIC fixtures, not production Source admission.
// No Go field supplies an owner/chain/deadline or opaque Native Source pointer.
func TestNativeAccountPurposeOwningInterop(t *testing.T) {
	fixture, pin := os.Getenv("YNX_NORMAL_NATIVE_FIXTURE"), os.Getenv("YNX_NORMAL_NATIVE_PIN")
	if fixture == "" || pin == "" {
		t.Skip("actual normal Native CPP test entry supplied by narrow original wrapper")
	}
	_, parentPin := testImage(t)
	f, err := os.Open(fixture)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	_, err = io.Copy(h, f)
	_ = f.Close()
	if err != nil || hex.EncodeToString(h.Sum(nil)) != pin {
		t.Fatal("normal Native fixture independent pin changed", err)
	}
	for _, mode := range []string{"normal", "profile-retire", "auth-retire", "ready-guard"} {
		t.Run(mode, func(t *testing.T) {
			var cmds [2]*exec.Cmd
			var logs [2]string
			for i, role := range []string{"core", "native"} {
				c := exec.Command(fixture, role, parentPin, pin, pin, mode)
				c.Dir = canonicalTemp(t)
				c.Env = []string{"ASAN_OPTIONS=halt_on_error=1", "UBSAN_OPTIONS=halt_on_error=1"}
				logs[i] = filepath.Join(c.Dir, "PUBLIC-normal-native.log")
				out, e := os.OpenFile(logs[i], os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
				if e != nil {
					t.Fatal(e)
				}
				t.Cleanup(func() { _ = out.Close() })
				c.Stdout = out
				c.Stderr = out
				// Real pre-existing inherited files prove the normal entry does not assume
				// account/current/source-parent FD3. The production bootstrap supplies them.
				for range i + 1 {
					extra, e := os.Open(os.DevNull)
					if e != nil {
						t.Fatal(e)
					}
					t.Cleanup(func() { _ = extra.Close() })
					c.ExtraFiles = append(c.ExtraFiles, extra)
				}
				cmds[i] = c
			}
			account := prepareAccount(t, cmds[0], cmds[1], pin)
			owner, err := NewLaunchOwnerWithSourceParentTransport(context.Background(), ChildSpec{cmds[0], pin}, ChildSpec{cmds[1], pin}, account)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = owner.Stop(ctx)
			})
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancel()
			startErr := owner.Start(ctx)
			const wanted = "PUBLIC_NORMAL_STARTUP_ONCE_SOURCE_PARTIAL_TYPED_SETTLE_PENDING_CUSTODY_NOT_ROOT"
			for {
				native, _ := os.ReadFile(logs[1])
				core, _ := os.ReadFile(logs[0])
				for _, raw := range [][]byte{native, core} {
					if strings.Contains(string(raw), "runtime error:") || strings.Contains(string(raw), "ERROR: AddressSanitizer") {
						t.Fatalf("actual normal Native sanitizer error native=%s core=%s", native, core)
					}
				}
				if strings.Contains(string(native), wanted) {
					t.Log(string(native))
					break
				}
				select {
				case <-ctx.Done():
					t.Fatalf("normal Native startup marker missing start=%v native=%s core=%s", startErr, native, core)
				case <-time.After(2 * time.Millisecond):
				}
			}
			_ = owner.Stop(ctx)
			if err = owner.Join(ctx); err != nil {
				t.Fatal(err)
			}
			assertLaunchReleased(t, owner, cmds[0], cmds[1])
			if !owner.LocalPhysicalReleased() || owner.Status().ProductionAdmission {
				t.Fatal("normal test entry leaked local custody or fabricated production admission", owner.Status())
			}
		})
	}
}
