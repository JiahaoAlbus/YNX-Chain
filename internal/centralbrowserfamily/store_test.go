package centralbrowserfamily

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestStoreCrashHelper(t *testing.T) {
	if os.Getenv("YNX_FAMILY_CRASH_HELPER") != "1" {
		return
	}
	key, err := protectedRead(os.Getenv("YNX_FAMILY_CRASH_SEAL"), 32)
	if err != nil {
		os.Exit(2)
	}
	store, err := openStore(os.Getenv("YNX_FAMILY_CRASH_STORE"), key, issuer+"\nynx-finance-v1-sso-v1\nhttps://finance.ynxweb4.com\nynx:finance:identity")
	if err != nil {
		os.Exit(3)
	}
	id := os.Getenv("YNX_FAMILY_CRASH_ID")
	err = store.update(func(s *durableState) error {
		f := s.Families[id]
		if f == nil {
			return errors.New("test record missing")
		}
		f.Fenced = true
		f.PendingRevoke = os.Getenv("YNX_FAMILY_CRASH_REQUEST")
		if os.Getenv("YNX_FAMILY_CRASH_PHASE") == "before-commit" {
			syscall.Kill(os.Getpid(), syscall.SIGKILL)
		}
		return nil
	})
	if err != nil {
		os.Exit(4)
	}
	syscall.Kill(os.Getpid(), syscall.SIGKILL)
	os.Exit(5)
}
func TestSIGKILLPreservesCommittedFenceAndRejectsPartialTransaction(t *testing.T) {
	for _, phase := range []string{"before-commit", "after-commit"} {
		t.Run(phase, func(t *testing.T) {
			f := newFixture(t)
			g, _ := f.login("")
			other, _ := f.login("")
			if err := f.client.Close(); err != nil {
				t.Fatal(err)
			}
			pending := randomToken()
			cmd := exec.Command(os.Args[0], "-test.run=^TestStoreCrashHelper$")
			cmd.Env = append(os.Environ(), "YNX_FAMILY_CRASH_HELPER=1", "YNX_FAMILY_CRASH_STORE="+f.cfg.StorePath, "YNX_FAMILY_CRASH_SEAL="+f.cfg.SealKeyPath, "YNX_FAMILY_CRASH_ID="+g.FamilyID, "YNX_FAMILY_CRASH_REQUEST="+pending, "YNX_FAMILY_CRASH_PHASE="+phase)
			err := cmd.Run()
			var exit *exec.ExitError
			if !errors.As(err, &exit) {
				t.Fatal("child did not stop at crash point", err)
			}
			status, ok := exit.Sys().(syscall.WaitStatus)
			if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
				t.Fatal("wrong crash terminal", err)
			}
			f.client, err = NewClient(f.cfg)
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.client.Resolve(context.Background(), g.FamilyID)
			if phase == "after-commit" {
				requireCode(t, err, CodeFenced)
				var failure *Error
				if !errors.As(err, &failure) || !failure.RevocationPending {
					t.Fatal("committed revocation target lost")
				}
				if err = f.client.Logout(context.Background(), LogoutInput{FamilyID: g.FamilyID}); err != nil {
					t.Fatal(err)
				}
			} else if err != nil {
				t.Fatal("uncommitted write escaped transaction", err)
			}
			if _, err = f.client.Resolve(context.Background(), other.FamilyID); err != nil {
				t.Fatal("other browser lost after crash", err)
			}
		})
	}
}
func TestExpiredCollectionPreservesActiveRecordsAndRecoversFamilyCapacity(t *testing.T) {
	f := newFixture(t)
	active, _ := f.login("")
	err := f.client.store.update(func(s *durableState) error {
		for len(s.Families) < 4096 {
			id := randomToken()
			s.Families[id] = &familyRecord{Grant: Grant{FamilyID: id, AbsoluteExpiresAt: f.cfg.Now().Add(-2 * time.Minute), IdleExpiresAt: f.cfg.Now().Add(-time.Hour)}, Fenced: true, PendingRevoke: randomToken()}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	fresh, _ := f.login("")
	if fresh.FamilyID == active.FamilyID {
		t.Fatal("active family overwritten")
	}
	if _, err = f.client.Resolve(context.Background(), active.FamilyID); err != nil {
		t.Fatal(err)
	}
	err = f.client.store.view(func(s *durableState) error {
		if len(s.Families) != 2 {
			return errors.New("expired capacity not recovered: " + strconv.Itoa(len(s.Families)))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
func TestRenewResponseAfterLogoutCannotOverwriteFence(t *testing.T) {
	f := newFixture(t)
	g, _ := f.login("")
	f.advance(241 * time.Second)
	f.mu.Lock()
	f.blockPath = "/v2/browser-sessions/renew"
	f.entered = make(chan struct{}, 1)
	f.release = make(chan struct{})
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := f.client.Resolve(context.Background(), g.FamilyID); done <- err }()
	<-f.entered
	if err := f.client.Logout(context.Background(), LogoutInput{FamilyID: g.FamilyID}); err != nil {
		t.Fatal(err)
	}
	close(f.release)
	requireCode(t, <-done, CodeFenced)
}
