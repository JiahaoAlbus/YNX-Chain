package cloud

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const publicSpecialQueryOwner = "PUBLIC_TEST_ACCOUNT"
const publicSpecialQueryID = "PUBLIC_query_original_123456"

// Real private journal + actual HTTP status handler. PUBLIC authority/executor
// seams do not approve a resource. A child process safely reproduces FIFO hangs.
func TestIDEDeploymentOriginalQueryRejectsSpecialFilesWithoutBlocking(t *testing.T) {
	if root := os.Getenv("YNX_PUBLIC_QUERY_SPECIAL_ROOT"); root != "" {
		journal, err := newIDEDeploymentJournal(root)
		if err != nil {
			t.Fatal(err)
		}
		switch os.Getenv("YNX_PUBLIC_QUERY_SPECIAL_MODE") {
		case "runtime":
			if _, err := journal.lookupRuntime(productHash([]byte(publicSpecialQueryOwner + "\x00" + publicSpecialQueryID))); err == nil {
				t.Fatal("special runtime record admitted")
			}
		case "original-replay":
			_, claim, err := journal.begin(publicSpecialQueryOwner, IDEDeploymentOperation{RequestID: publicSpecialQueryID, ManifestSHA256: "PUBLIC_MANIFEST", ApprovalSHA256: "PUBLIC_APPROVAL", PublisherID: "PUBLIC_PUBLISHER", CreatedAt: time.Now()})
			if err == nil || claim {
				t.Fatal("existing uncertain record admitted replay")
			}
		default:
			server, _, executor, handler := publicIDEFixture(t)
			server.ideDeployments.journal = journal
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, httptest.NewRequest("GET", "/api/v1/ide/deployments/"+publicSpecialQueryID, nil))
			if out.Code < 400 || executor.applies != 0 || executor.observes != 0 || executor.logs != 0 {
				t.Fatal("invalid original query produced a result or resource action", out.Code)
			}
		}
		return
	}
	for _, mode := range []string{"status", "runtime", "original-replay", "status-symlink-fifo"} {
		t.Run(mode, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "private-journal")
			journal, err := newIDEDeploymentJournal(root)
			if err != nil {
				t.Fatal(err)
			}
			file := journal.file(publicSpecialQueryOwner, publicSpecialQueryID)
			target := file
			if mode == "status-symlink-fifo" {
				target = filepath.Join(root, "PUBLIC_FIFO_TARGET")
			}
			if err := unix.Mkfifo(target, 0600); err != nil {
				t.Fatal(err)
			}
			if target != file {
				if err := os.Symlink(target, file); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIDEDeploymentOriginalQueryRejectsSpecialFilesWithoutBlocking$", "-test.count=1")
			cmd.Env = append(os.Environ(), "YNX_PUBLIC_QUERY_SPECIAL_ROOT="+root, "YNX_PUBLIC_QUERY_SPECIAL_MODE="+mode)
			output, err := cmd.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatal("original request query blocked before record type validation", ctx.Err())
			}
			if err != nil {
				t.Fatalf("query subprocess failed: %v %s", err, output)
			}
			info, err := os.Lstat(target)
			if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
				t.Fatal("original special record was changed", err)
			}
			if target != file {
				info, err = os.Lstat(file)
				if err != nil || info.Mode()&os.ModeSymlink == 0 {
					t.Fatal("original link replaced", err)
				}
			}
		})
	}
}
