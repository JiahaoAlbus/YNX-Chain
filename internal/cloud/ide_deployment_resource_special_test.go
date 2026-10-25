package cloud

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// A separate real process prevents a FIFO-open regression from hanging the
// test runner itself. No engine, image, authority or deployment is activated.
func TestIDEDeploymentResourceSpecialFileDoesNotBlock(t *testing.T) {
	if file := os.Getenv("YNX_PUBLIC_RESOURCE_SPECIAL_FILE"); file != "" {
		e := &OCIIDEDeploymentExecutor{cfg: IDEExistingOCIConfig{ResourceID: "PUBLIC_RESOURCE"}}
		if err := e.reconcileResourceRecord(context.Background(), file, IDEDeploymentPermit{RequestID: "PUBLIC_NEW_REQUEST"}); err == nil {
			t.Fatal("special resource record admitted")
		}
		return
	}
	for _, kind := range []string{"fifo", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, "reservation.json")
			if kind == "fifo" {
				if err := unix.Mkfifo(file, 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				target := filepath.Join(root, "target")
				if err := os.WriteFile(target, []byte("PUBLIC_ORIGINAL_UNCHANGED"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, file); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIDEDeploymentResourceSpecialFileDoesNotBlock$", "-test.count=1")
			cmd.Env = append(os.Environ(), "YNX_PUBLIC_RESOURCE_SPECIAL_FILE="+file)
			out, err := cmd.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatal("resource record read blocked before file type validation", ctx.Err())
			}
			if err != nil {
				t.Fatalf("special record helper: %v %s", err, out)
			}
			info, err := os.Lstat(file)
			if err != nil {
				t.Fatal("original record removed", err)
			}
			if kind == "fifo" && info.Mode()&os.ModeNamedPipe == 0 {
				t.Fatal("FIFO replaced")
			}
			if kind == "symlink" {
				b, err := os.ReadFile(filepath.Join(root, "target"))
				if err != nil || string(b) != "PUBLIC_ORIGINAL_UNCHANGED" {
					t.Fatal("symlink target modified", err)
				}
			}
		})
	}
}
