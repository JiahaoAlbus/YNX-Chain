package datafabricpostgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

// EmitConnectionEvent uses the existing PostgreSQL event/Outbox transaction.
// This adapter is strictly asynchronous: callers must record their own Wallet,
// Product Session, Card, or Financial outcome before attempting this write.
func (s *Store) EmitConnectionEvent(ctx context.Context, input datafabric.ConnectionEvent, keyID string, key []byte) (datafabric.EventEnvelope, error) {
	event, err := datafabric.BuildConnectionEventEnvelope(input, keyID, key)
	if err != nil {
		return datafabric.EventEnvelope{}, err
	}
	if err := s.Append(ctx, event, key); err != nil {
		return datafabric.EventEnvelope{}, err
	}
	return event, nil
}

// ConsumeConnectionDiagnostics increments only bounded aggregate metrics in
// the same transaction as the Inbox marker. No user, account, connection ID,
// raw endpoint, raw error, credential, or funding value is persisted here.
func (s *Store) ConsumeConnectionDiagnostics(ctx context.Context, eventID string) (bool, error) {
	return s.ApplyProjection(ctx, datafabric.ConnectionDiagnosticsConsumer, eventID, func(ctx context.Context, tx *sql.Tx, event datafabric.EventEnvelope) (string, error) {
		dimensions, err := datafabric.ConnectionDiagnosticDimensions(event)
		if err != nil {
			return "", err
		}
		for _, dimension := range dimensions {
			if _, err := tx.ExecContext(ctx, `
INSERT INTO ynx_fabric.connection_diagnostics(metric,dimension,count)
VALUES ($1,$2,1)
ON CONFLICT (metric,dimension) DO UPDATE SET count=ynx_fabric.connection_diagnostics.count+1`, dimension.Metric, dimension.Dimension); err != nil {
				return "", err
			}
		}
		digest := sha256.Sum256([]byte("ynx-data-fabric-connection-diagnostics-v1\x00" + event.EventID + "\x00" + event.Integrity.Digest))
		return hex.EncodeToString(digest[:]), nil
	})
}
