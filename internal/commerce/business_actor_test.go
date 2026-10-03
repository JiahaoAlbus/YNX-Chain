package commerce

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestBusinessActorKeepsOriginalNamespaceAcrossDeletionAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := Open(path)
	_, canonical := actor(t, 2)
	native, err := accountaddress.Encode(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveProfile(native, "inherited native records", nil); err != nil {
		t.Fatal(err)
	}
	proof := businessProof(s)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		account, err := tx.resolveBusinessActor(native)
		if err != nil {
			return err
		}
		if account != native {
			t.Fatal("inherited account was rekeyed")
		}
		_, err = tx.SaveProfile(account, "same inherited account", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	proof.Nonce = strings.Repeat("c", 43)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		account, err := tx.resolveBusinessActor(native)
		if err != nil {
			return err
		}
		_, err = tx.DeleteBuyerData(account)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	proof.Nonce = strings.Repeat("d", 43)
	if err := reopened.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		account, err := tx.resolveBusinessActor(native)
		if err != nil {
			return err
		}
		if account != native {
			t.Fatal("deletion changed retired request namespace")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if reopened.Profile(native).DisplayName != "" || len(reopened.s.BusinessActorNamespaces) != 1 {
		t.Fatal("deletion left profile or lost namespace guard")
	}
}

func TestBusinessActorCanonicalRecordsAndCollisionNeverMerge(t *testing.T) {
	s, _ := Open("")
	_, canonical := actor(t, 2)
	native, _ := accountaddress.Encode(canonical)
	_, _ = s.SaveProfile(canonical, "canonical inherited", nil)
	proof := businessProof(s)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error {
		account, err := tx.resolveBusinessActor(native)
		if err != nil {
			return err
		}
		if account != canonical {
			t.Fatal("canonical original key lost")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, _ = s.SaveProfile(native, "separate old data", nil)
	proof.Nonce = strings.Repeat("c", 43)
	if err := s.withBusinessAction(context.Background(), proof, currentBusinessActor, func(tx *Store) error { _, err := tx.resolveBusinessActor(native); return err }); !errors.Is(err, ErrConflict) {
		t.Fatal("both namespaces silently merged", err)
	}
	if s.Profile(canonical).DisplayName != "canonical inherited" || s.Profile(native).DisplayName != "separate old data" || len(s.s.BusinessNonces) != 1 {
		t.Fatal("collision changed data or nonce")
	}
	bad := native[:len(native)-1] + "q"
	if bad == native {
		bad = native[:len(native)-1] + "p"
	}
	if _, err := s.resolveBusinessActor(bad); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("unchecked wallet alias accepted", err)
	}
}
