package commerce

import (
	"testing"
	"time"
)

func acceptSellerRole(t *testing.T, store *Store, owner, storeID, account, role string) SellerInvitation {
	t.Helper()
	invitation, err := store.CreateSellerInvitation(owner, storeID, account, role, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := store.AcceptSellerInvitation(account, invitation.ID)
	if err != nil {
		t.Fatal(err)
	}
	return accepted
}
