package music

import (
	"errors"
	"reflect"
	"testing"
)

func TestCentralSettlementReviewMustUseExactWalletRoute(t *testing.T) {
	svc := testService(t)
	creator := testAccount(t, 3)
	listener := testAccount(t, 12)
	track := publishTrack(t, svc, creator, false)
	if _, err := svc.UpsertProfile(listener, Profile{DisplayName: "Listener"}); err != nil {
		t.Fatal(err)
	}
	_, usage, err := svc.SavePosition(listener, track.ID, "wallet-review-route", 1200, true)
	if err != nil {
		t.Fatal(err)
	}
	allocation, err := svc.Allocate(creator, "review-route-real-source", 1000, []string{usage.ID})
	if err != nil {
		t.Fatal(err)
	}
	intent, err := svc.SettlementIdempotent(creator, "review-route-key", allocation.ID, creator)
	if err != nil {
		t.Fatal(err)
	}
	for _, uri := range []string{"ynxpay://settlement/reviewer?intent=1", "ynxpay://settlement/review/extra", "ynxpay://settlement/review#other", "ynxpay://user@settlement/review", "ynxpay://settlement:42/review", "https://settlement/review", "ynx-pay://settlement/review", "ynxpay://settlement/review%2fextra"} {
		before, _ := svc.SettlementByID(creator, intent.ID)
		audit := len(svc.state.Audit)
		_, err := svc.LinkCentralSettlement(creator, intent.ID, "central-review", uri)
		after, _ := svc.SettlementByID(creator, intent.ID)
		if !errors.Is(err, ErrInvalid) || !reflect.DeepEqual(before, after) || len(svc.state.Audit) != audit {
			t.Fatalf("unsafe review URI mutated settlement: %q err=%v before=%#v after=%#v", uri, err, before, after)
		}
	}
	valid := "ynxpay://settlement/review?intent=central-review&opaque=original%2Fvalue"
	linked, err := svc.LinkCentralSettlement(creator, intent.ID, "central-review", valid)
	if err != nil || linked.ReviewURI != valid || linked.CentralIntentID != "central-review" || linked.Status != "requires_wallet_review" {
		t.Fatalf("valid original review route changed: %#v %v", linked, err)
	}
	if err := svc.VerifyIntegrity(); err != nil {
		t.Fatal(err)
	}
}
