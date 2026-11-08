package productreadsource

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// PUBLIC test storage only, not Root resources or a Source constructor. The
// same real nonroot UID and production originalFiles checks remain required.
func ownedProtectedFixture(t *testing.T) string {
	t.Helper()
	uid := os.Geteuid()
	if uid == 0 {
		t.Fatal("PUBLIC fixture requires the actual nonroot test user")
	}
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) || filepath.Clean(home) != home {
		t.Fatal("owned user home required", err)
	}
	resolved, err := filepath.EvalSymlinks(home)
	if err != nil || resolved != home {
		t.Fatal("user home must be canonical without symlinks", err)
	}
	homeID, err := os.Lstat(home)
	if err != nil || !homeID.IsDir() || homeID.Mode()&os.ModeSymlink != 0 {
		t.Fatal("user home identity", err)
	}
	owner, ok := homeID.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(uid) {
		t.Fatal("user home must belong to the actual test UID")
	}
	// Short enough for Darwin/Linux sockaddr_un without a world-writable /tmp
	// fallback, hard-coded Mac username, precreated .codex or sudo setup.
	p, err := os.MkdirTemp(home, ".ynxp-")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := os.Lstat(p)
	if err != nil || !identity.IsDir() || identity.Mode()&os.ModeSymlink != 0 {
		t.Fatal("new fixture identity", err)
	}
	stat, ok := identity.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(uid) {
		t.Fatal("new fixture owner")
	}
	if identity.Mode().Perm() != 0700 {
		t.Fatal("new fixture must be 0700")
	}
	t.Cleanup(func() {
		// Never clean a replaced parent or unknown child; only the exact four
		// PUBLIC names from these original tests are eligible for removal.
		named, e := os.Lstat(p)
		if e != nil || !named.IsDir() || named.Mode()&os.ModeSymlink != 0 || !os.SameFile(identity, named) || named.Mode().Perm() != 0700 {
			t.Log("fixture retained (original parent changed):", p, e)
			return
		}
		current, valid := named.Sys().(*syscall.Stat_t)
		if !valid || current.Uid != uint32(uid) {
			t.Log("fixture retained (owner changed):", p)
			return
		}
		for _, name := range []string{"sock", "original", "saved", "alias"} {
			_ = os.Remove(filepath.Join(p, name))
		}
		if e = os.Remove(p); e != nil {
			t.Log("fixture retained (unknown child):", p, e)
		}
	})
	if len(filepath.Join(p, "sock")) > 103 {
		t.Fatal("owned fixture exceeds the bounded Unix socket path")
	}
	t.Log("PUBLIC fixture", p)
	return p
}
