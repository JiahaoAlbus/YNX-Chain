//go:build commerce_v2

package commerce

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestOriginalShopBrowserSealProtectedProductOperand(t *testing.T) {
	base := os.Getenv("YNX_SHOP_PROTECTED_FIXTURE_ROOT")
	if base == "" {
		var err error
		base, err = os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
	}
	dir, err := os.MkdirTemp(base, ".ynx-shop-seal-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "seal")
	original := bytes.Repeat([]byte{0xab}, 32)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	// Some explicitly selected external QA volumes have group-writable mount
	// roots. The real loader must reject that ancestry. Do not relax it to make
	// a positive fixture fit the volume; the normal CI home runs the full case.
	if os.Getenv("YNX_SHOP_PROTECTED_FIXTURE_ROOT") != "" {
		for parent := dir; ; parent = filepath.Dir(parent) {
			info, e := os.Stat(parent)
			if e != nil {
				t.Fatal(e)
			}
			if info.Mode().Perm()&0022 != 0 {
				if material, e := loadOriginalShopBrowserSeal(path); e == nil || len(material) != 0 {
					clear(material)
					t.Fatal("unprotected fixture ancestry accepted")
				}
				t.Skip("positive protected-file fixture unavailable on selected writable volume; denial verified, full case required in normal CI")
			}
			if parent == filepath.Dir(parent) {
				break
			}
		}
	}
	got, err := loadOriginalShopBrowserSeal(path)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatal("protected original seal rejected", err)
	}
	clear(got)
	for _, mode := range []string{"relative", "short", "long", "public", "hardlink", "leaf-link", "parent-link", "writable-parent"} {
		t.Run(mode, func(t *testing.T) {
			candidate := path
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "relative":
				candidate = "seal"
			case "short":
				if err := os.WriteFile(path, original[:31], 0600); err != nil {
					t.Fatal(err)
				}
			case "long":
				if err := os.WriteFile(path, append(bytes.Clone(original), 0), 0600); err != nil {
					t.Fatal(err)
				}
			case "public":
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(path, 0600)
			case "hardlink":
				link := filepath.Join(dir, "hard")
				if err := os.Link(path, link); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(link)
			case "leaf-link":
				candidate = filepath.Join(dir, "link")
				if err := os.Symlink(path, candidate); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(candidate)
			case "parent-link":
				link := filepath.Join(dir, "linked-parent")
				if err := os.Symlink(dir, link); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(link)
				candidate = filepath.Join(link, "seal")
			case "writable-parent":
				if err := os.Chmod(dir, 0770); err != nil {
					t.Fatal(err)
				}
				defer os.Chmod(dir, 0700)
			}
			got, err := loadOriginalShopBrowserSeal(candidate)
			if err == nil || len(got) != 0 {
				clear(got)
				t.Fatal("unprotected seal accepted", mode)
			}
		})
	}
}
