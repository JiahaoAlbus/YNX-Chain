package developerauthority

import (
	"context"
	"database/sql/driver"
	"errors"
	"io"
	"testing"
)

// PUBLIC native enrollment seam. No real device/Root/grant is produced here.
type publicRecoverySource struct {
	*publicSource
	enrolls, observes int
	actual            *RecoveryResult
	callErr           error
	sql               *publicSQL
}

func (s *publicRecoverySource) AuthorizeExistingAccountRecovery(_ context.Context, p Principal, r RecoveryRequest, proof []byte) (Approval, error) {
	return Approval{objectHash(p), objectHash(r), hash(proof), "PUBLIC-recovery-confirmation", "PUBLIC-recovery-revoke", publicNow + 1000}, nil
}
func (s *publicRecoverySource) AssertRecoveryCurrent(context.Context, Principal, RecoveryRequest, Approval) error {
	return nil
}
func (s *publicRecoverySource) EnrollOriginalDeviceForExistingAccount(_ context.Context, _ Principal, r RecoveryRequest, _ Approval) (*RecoveryResult, error) {
	s.enrolls++
	if len(s.sql.executed) == 0 {
		return nil, ErrDenied
	}
	s.actual = &RecoveryResult{r.RequestID, r.Account, r.DeviceID, r.DevicePublicSHA256, "PUBLIC-original-registration", "registered-existing-account", []byte("PUBLIC signed-device-original fixture")}
	return s.actual, s.callErr
}
func (s *publicRecoverySource) ObserveOriginalDeviceEnrollment(context.Context, Principal, RecoveryRequest) (*RecoveryResult, error) {
	s.observes++
	return s.actual, s.callErr
}
func publicRecovery() RecoveryRequest {
	return RecoveryRequest{"same-account-new-device-request", "existing-account", "original-device", hash([]byte("PUBLIC device")), publicNow + 2000}
}
func TestRecoverySameExistingAccountAndTargetDeviceRequired(t *testing.T) {
	for _, change := range []func(*RecoveryRequest){func(r *RecoveryRequest) { r.Account = "replacement-account" }, func(r *RecoveryRequest) { r.DeviceID = "copied-old-device" }, func(r *RecoveryRequest) { r.ExpiresMS = publicNow }} {
		s := &publicSQL{}
		base := &publicSource{p: publicPrincipal()}
		c := publicCatalog(t, s, base)
		source := &publicRecoverySource{publicSource: base, sql: s}
		c.source = source
		r := publicRecovery()
		change(&r)
		if _, e := c.RecoverExistingIdentity(context.Background(), publicRequest(), r, []byte("PUBLIC-recovery-N1")); e == nil || source.enrolls != 0 || writes(s) != 0 {
			t.Fatal("recovery widened account/device", e)
		}
	}
}
func TestRecoveryUnknownReservedBeforeSoleEnrollment(t *testing.T) {
	s := &publicSQL{}
	base := &publicSource{p: publicPrincipal()}
	c := publicCatalog(t, s, base)
	source := &publicRecoverySource{publicSource: base, sql: s}
	c.source = source
	r, e := c.RecoverExistingIdentity(context.Background(), publicRequest(), publicRecovery(), []byte("PUBLIC-recovery-N1"))
	if e != nil || r == nil || r.Account != "existing-account" || source.enrolls != 1 || writes(s) != 2 {
		t.Fatal(r, e)
	}
	s.duplicate = true
	if _, e = c.RecoverExistingIdentity(context.Background(), publicRequest(), publicRecovery(), []byte("PUBLIC-recovery-N1")); !errors.Is(e, ErrUnknown) || source.enrolls != 1 {
		t.Fatal("recovery invoked twice", e)
	}
}
func TestRecoveryPartialAndErrorRetainedUnknown(t *testing.T) {
	s := &publicSQL{}
	base := &publicSource{p: publicPrincipal()}
	c := publicCatalog(t, s, base)
	source := &publicRecoverySource{publicSource: base, sql: s, callErr: io.ErrUnexpectedEOF}
	c.source = source
	r, e := c.RecoverExistingIdentity(context.Background(), publicRequest(), publicRecovery(), []byte("PUBLIC-recovery-N1"))
	if !errors.Is(e, ErrUnknown) || r == nil || len(r.PublicOriginal) == 0 {
		t.Fatal("lost actual partial", e)
	}
	source.actual.PublicOriginal[0] = 'X'
	if r.PublicOriginal[0] == 'X' {
		t.Fatal("mutable native partial escaped")
	}
	args := s.args[len(s.args)-1]
	if args[2].Value != "unknown" {
		t.Fatal("error upgraded to recovered")
	}
}
func TestRecoveryMissingObserveNeverEnrolls(t *testing.T) {
	s := &publicSQL{queries: [][][]driver.Value{nil}}
	base := &publicSource{p: publicPrincipal()}
	c := publicCatalog(t, s, base)
	source := &publicRecoverySource{publicSource: base, sql: s}
	c.source = source
	if _, e := c.ObserveExistingIdentityRecovery(context.Background(), publicRequest(), "original-unknown-request"); !errors.Is(e, ErrUnknown) || source.enrolls != 0 || source.observes != 0 || writes(s) != 0 {
		t.Fatal("missing observe created or reported not-sent", e)
	}
}
