package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSnapshotFutureVersionRejectedWithoutMutation(t *testing.T) {
	for _, authenticated := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "authenticated"}[authenticated], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "commerce.json")
			snapshot := emptySnapshot()
			snapshot.Version = currentSnapshotVersion + 1
			var key []byte
			if authenticated {
				key = bytes.Repeat([]byte{0x51}, 32)
			}
			data, err := encodePersisted(snapshot, key)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}

			if authenticated {
				_, err = OpenWithIntegrity(path, key)
			} else {
				_, err = Open(path)
			}
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("unsupported commerce snapshot version %d", currentSnapshotVersion+1)) {
				t.Fatalf("future snapshot opened: %v", err)
			}
			unchanged, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if !bytes.Equal(unchanged, data) {
				t.Fatal("future snapshot was rewritten before rejection")
			}
		})
	}
}

func TestSnapshotRollbackExportV5PreservesRepresentableStateAndRestores(t *testing.T) {
	dir := t.TempDir()
	activePath := filepath.Join(dir, "active.json")
	rollbackPath := filepath.Join(dir, "rollback-v5.json")
	restorePath := filepath.Join(dir, "restore.json")
	key := bytes.Repeat([]byte{0x62}, 32)
	now := time.Date(2026, 7, 28, 12, 30, 0, 0, time.UTC)

	s, err := OpenWithIntegrity(activePath, key)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.s.Stores["store_rollback"] = StoreProfile{ID: "store_rollback", Owner: "ynx_owner", Name: "Rollback store", CreatedAt: now, UpdatedAt: now}
	s.s.SellerRoles["store_rollback"] = map[string]string{"ynx_owner": SellerRoleOwner, "ynx_admin": SellerRoleAdmin}
	s.s.SellerRevocations["revoke_1"] = SellerRoleRevocation{ID: "revoke_1", StoreID: "store_rollback", Account: "ynx_support", PreviousRole: SellerRoleSupport, Reason: "access removed", SessionStatus: "confirmed", SessionRevocationID: "wallet_revoke_1", SessionCount: 1, RequestedAt: now, UpdatedAt: now}
	s.s.Audits = append(s.s.Audits, AuditEvent{ID: "audit_1", Actor: "ynx_owner", Role: SellerRoleOwner, Action: "seller.role.revoke", ObjectType: "seller_role", ObjectID: "ynx_support", Outcome: "success", At: now})
	s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{ID: "seller_event_1", EventName: "ynx.seller.role.revoked.v1", Source: "seller-console", StoreID: "store_rollback", Account: "ynx_support", Actor: "ynx_owner", RevocationID: "revoke_1", PreviousRole: SellerRoleSupport, SessionStatus: "confirmed", SessionRevocationID: "wallet_revoke_1", SchemaVersion: 1, SessionCount: 1, OccurredAt: now})
	err = s.persistLocked()
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	if err := s.ExportRollbackSnapshot(rollbackPath, 5); err != nil {
		t.Fatal(err)
	}
	fields := rollbackFields(t, rollbackPath, key)
	assertRollbackVersion(t, fields, 5)
	if _, ok := fields["SellerInvitations"]; ok {
		t.Fatal("Snapshot v5 export retained SellerInvitations")
	}
	if _, ok := fields["SellerRevocations"]; !ok {
		t.Fatal("Snapshot v5 export dropped SellerRevocations")
	}
	if _, ok := fields["Audits"]; !ok {
		t.Fatal("Snapshot v5 export dropped audit records")
	}
	var events []map[string]json.RawMessage
	if err := json.Unmarshal(fields["SellerEvents"], &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("unexpected Snapshot v5 events: %v", events)
	}
	for _, field := range []string{"InvitationID", "Role", "Status", "ExpiresAt"} {
		if _, ok := events[0][field]; ok {
			t.Fatalf("Snapshot v5 event retained v6-only field %s", field)
		}
	}

	rollbackBytes, err := os.ReadFile(rollbackPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(restorePath+".bak", rollbackBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	activeBeforeRestore := emptySnapshot()
	activeBeforeRestore.Stores["discarded"] = StoreProfile{ID: "discarded", Owner: "ynx_other", Name: "Discarded"}
	activeBytes, err := encodePersisted(activeBeforeRestore, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(restorePath, activeBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommerceBackup(restorePath, key); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenWithIntegrity(restorePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if restored.s.Version != currentSnapshotVersion || restored.s.Stores["store_rollback"].ID == "" || restored.s.Stores["discarded"].ID != "" {
		t.Fatalf("rollback restore did not migrate the intended state: version=%d stores=%v", restored.s.Version, restored.s.Stores)
	}
	if restored.s.SellerRoles["store_rollback"]["ynx_admin"] != SellerRoleAdmin || restored.s.SellerRevocations["revoke_1"].SessionStatus != "confirmed" || len(restored.s.Audits) != 1 || len(restored.s.SellerEvents) != 1 {
		t.Fatalf("rollback restore lost representable Seller state: roles=%v revocations=%v audits=%v events=%v", restored.s.SellerRoles, restored.s.SellerRevocations, restored.s.Audits, restored.s.SellerEvents)
	}
}

func TestSnapshotRollbackExportVersionBoundaries(t *testing.T) {
	now := time.Date(2026, 7, 28, 13, 0, 0, 0, time.UTC)

	t.Run("v3 preserves roles and audits", func(t *testing.T) {
		s, err := Open("")
		if err != nil {
			t.Fatal(err)
		}
		s.s.SellerRoles["store_v3"] = map[string]string{"ynx_admin": SellerRoleAdmin}
		s.s.Audits = []AuditEvent{{ID: "audit_v3", Actor: "ynx_owner", Action: "seller.role.update", At: now}}
		path := filepath.Join(t.TempDir(), "rollback-v3.json")
		if err := s.ExportRollbackSnapshot(path, 3); err != nil {
			t.Fatal(err)
		}
		fields := rollbackFields(t, path, nil)
		assertRollbackVersion(t, fields, 3)
		for _, absent := range []string{"SellerRevocations", "SellerInvitations", "SellerEvents"} {
			if _, ok := fields[absent]; ok {
				t.Fatalf("Snapshot v3 retained unsupported field %s", absent)
			}
		}
		if _, ok := fields["SellerRoles"]; !ok {
			t.Fatal("Snapshot v3 dropped SellerRoles")
		}
		if _, ok := fields["Audits"]; !ok {
			t.Fatal("Snapshot v3 dropped Audits")
		}
	})

	t.Run("v4 preserves revocations", func(t *testing.T) {
		s, err := Open("")
		if err != nil {
			t.Fatal(err)
		}
		s.s.SellerRevocations["revoke_v4"] = SellerRoleRevocation{ID: "revoke_v4", StoreID: "store_v4", Account: "ynx_member", PreviousRole: SellerRoleViewer, SessionStatus: "pending", RequestedAt: now, UpdatedAt: now}
		path := filepath.Join(t.TempDir(), "rollback-v4.json")
		if err := s.ExportRollbackSnapshot(path, 4); err != nil {
			t.Fatal(err)
		}
		fields := rollbackFields(t, path, nil)
		assertRollbackVersion(t, fields, 4)
		if _, ok := fields["SellerRevocations"]; !ok {
			t.Fatal("Snapshot v4 dropped SellerRevocations")
		}
		for _, absent := range []string{"SellerInvitations", "SellerEvents"} {
			if _, ok := fields[absent]; ok {
				t.Fatalf("Snapshot v4 retained unsupported field %s", absent)
			}
		}
	})
}

func TestSnapshotRollbackExportRefusesLossyOrDestructiveOperations(t *testing.T) {
	now := time.Date(2026, 7, 28, 13, 30, 0, 0, time.UTC)
	tests := []struct {
		name          string
		targetVersion int
		mutate        func(*Store)
		want          string
	}{
		{
			name:          "v5 invitation",
			targetVersion: 5,
			mutate: func(s *Store) {
				s.s.SellerInvitations["invite_1"] = SellerInvitation{ID: "invite_1", StoreID: "store_1", Account: "ynx_target", Role: SellerRoleViewer, Status: "pending", CreatedAt: now, ExpiresAt: now.Add(time.Hour), UpdatedAt: now}
			},
			want: "cannot represent Seller invitations",
		},
		{
			name:          "v5 invitation event",
			targetVersion: 5,
			mutate: func(s *Store) {
				s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{ID: "event_invite", EventName: "ynx.seller.team.invitation.created.v1", InvitationID: "invite_1", Role: SellerRoleViewer, Status: "pending", ExpiresAt: now.Add(time.Hour), OccurredAt: now})
			},
			want: "Snapshot v5 cannot represent Seller event",
		},
		{
			name:          "v4 seller event",
			targetVersion: 4,
			mutate: func(s *Store) {
				s.s.SellerEvents = append(s.s.SellerEvents, SellerIntegrationEvent{ID: "event_1", EventName: "ynx.seller.role.revoked.v1", OccurredAt: now})
			},
			want: "cannot represent Seller integration events",
		},
		{
			name:          "v3 revocation",
			targetVersion: 3,
			mutate: func(s *Store) {
				s.s.SellerRevocations["revoke_1"] = SellerRoleRevocation{ID: "revoke_1"}
			},
			want: "cannot represent Seller role revocations",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := Open("")
			if err != nil {
				t.Fatal(err)
			}
			tt.mutate(s)
			path := filepath.Join(t.TempDir(), "rollback.json")
			err = s.ExportRollbackSnapshot(path, tt.targetVersion)
			if !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("lossy rollback was not refused: %v", err)
			}
			if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
				t.Fatalf("refused rollback left an output file: %v", statErr)
			}
		})
	}

	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []int{2, currentSnapshotVersion, currentSnapshotVersion + 1} {
		path := filepath.Join(t.TempDir(), "invalid.json")
		if err := s.ExportRollbackSnapshot(path, target); err == nil || !strings.Contains(err.Error(), "rollback target must be Snapshot v3, v4, v5 or v6") {
			t.Fatalf("invalid rollback target %d accepted: %v", target, err)
		}
	}

	t.Run("existing output is never overwritten", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "existing.json")
		sentinel := []byte("operator-owned\n")
		if err := os.WriteFile(path, sentinel, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := s.ExportRollbackSnapshot(path, 5); err == nil {
			t.Fatal("existing rollback output was overwritten")
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, sentinel) {
			t.Fatalf("existing rollback output changed: %q", got)
		}
	})

	t.Run("active state is never overwritten", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "active.json")
		active, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		active.s.Stores["store_active"] = StoreProfile{ID: "store_active"}
		active.mu.Lock()
		err = active.persistLocked()
		active.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := active.ExportRollbackSnapshot(path, 5); err == nil || !strings.Contains(err.Error(), "must not overwrite the active state path") {
			t.Fatalf("active state overwrite was not refused: %v", err)
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, after) {
			t.Fatal("active state changed during refused rollback export")
		}
	})
}

func TestSnapshotRollbackExportTamperAndFutureBackupFailClosed(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{0x73}, 32)
	s, err := OpenWithIntegrity(filepath.Join(dir, "source.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	rollbackPath := filepath.Join(dir, "rollback.json")
	if err := s.ExportRollbackSnapshot(rollbackPath, 5); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(rollbackPath)
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Replace(data, []byte(`"Version": 5`), []byte(`"Version": 4`), 1)
	if bytes.Equal(tampered, data) {
		t.Fatal("rollback fixture did not contain the expected version field")
	}
	if err := os.WriteFile(rollbackPath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenWithIntegrity(rollbackPath, key); err == nil || !strings.Contains(err.Error(), "commerce state HMAC mismatch") {
		t.Fatalf("tampered rollback snapshot opened: %v", err)
	}

	activePath := filepath.Join(dir, "active.json")
	active := emptySnapshot()
	active.Stores["active_store"] = StoreProfile{ID: "active_store"}
	activeData, err := encodePersisted(active, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(activePath, activeData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(activePath+".bak", tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommerceBackup(activePath, key); err == nil || !strings.Contains(err.Error(), "commerce state HMAC mismatch") {
		t.Fatalf("tampered rollback backup restored: %v", err)
	}
	unchanged, err := os.ReadFile(activePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unchanged, activeData) {
		t.Fatal("active state changed after tampered backup refusal")
	}

	future := emptySnapshot()
	future.Version = currentSnapshotVersion + 1
	futureData, err := encodePersisted(future, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(activePath+".bak", futureData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCommerceBackup(activePath, key); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("unsupported commerce snapshot version %d", currentSnapshotVersion+1)) {
		t.Fatalf("future rollback backup restored: %v", err)
	}
	unchanged, err = os.ReadFile(activePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unchanged, activeData) {
		t.Fatal("active state changed after future backup refusal")
	}
}

func rollbackFields(t *testing.T, path string, key []byte) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Snapshot
	if err := decodePersisted(data, key, &snapshot); err != nil {
		t.Fatal(err)
	}
	payload := bytes.TrimSpace(data)
	if len(key) > 0 {
		var envelope persistedEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			t.Fatal(err)
		}
		payload = envelope.Snapshot
	}
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	return fields
}

func assertRollbackVersion(t *testing.T, fields map[string]json.RawMessage, want int) {
	t.Helper()
	var got int
	if err := json.Unmarshal(fields["Version"], &got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("rollback version=%d want=%d", got, want)
	}
}
