package datafabricapi

import (
	"context"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

// Repository is the authoritative persistence boundary for the HTTP API. Every
// method accepts request context so cancellation and deadlines reach a remote
// transactional database instead of being discarded at the handler boundary.
type Repository interface {
	Append(context.Context, datafabric.EventEnvelope, []byte) error
	Events(context.Context) ([]datafabric.EventEnvelope, error)
	Event(context.Context, string) (datafabric.EventEnvelope, bool, error)
	PostJournal(context.Context, datafabric.JournalEntry) error
	Journal(context.Context) ([]datafabric.JournalEntry, error)
	JournalEntry(context.Context, string) (datafabric.JournalEntry, bool, error)
	StartSaga(context.Context, datafabric.SagaInstance) error
	Saga(context.Context, string) (datafabric.SagaInstance, bool, error)
	Sagas(context.Context) ([]datafabric.SagaInstance, error)
	CompleteSagaStep(context.Context, string, string, time.Time) error
	FailSaga(context.Context, string, string, time.Time) error
	CompleteSagaCompensation(context.Context, string, string, time.Time) error
	RequireSagaManualRecovery(context.Context, string, string, time.Time) error
	ReconcileJournal(context.Context, string, string, string, string, string, []string, []datafabric.SettlementObservation, time.Time) (datafabric.ReconciliationRun, error)
	Reconciliations(context.Context) ([]datafabric.ReconciliationRun, error)
	ExportSubject(context.Context, string, string, time.Time) (datafabric.SubjectExport, error)
	RecordErasure(context.Context, string, string, []byte, time.Time) (datafabric.ErasureRecord, error)
	AuditIntegrity(context.Context, map[string][]byte) error
	Stats(context.Context) (datafabric.StoreStats, error)
}

type LocalRepository struct{ Store *datafabric.Store }

func (r LocalRepository) Append(_ context.Context, event datafabric.EventEnvelope, key []byte) error {
	return r.Store.Append(event, key)
}
func (r LocalRepository) Events(context.Context) ([]datafabric.EventEnvelope, error) {
	return r.Store.Events(), nil
}
func (r LocalRepository) Event(_ context.Context, id string) (datafabric.EventEnvelope, bool, error) {
	event, exists := r.Store.Event(id)
	return event, exists, nil
}
func (r LocalRepository) PostJournal(_ context.Context, entry datafabric.JournalEntry) error {
	return r.Store.PostJournal(entry)
}
func (r LocalRepository) Journal(context.Context) ([]datafabric.JournalEntry, error) {
	return r.Store.Journal(), nil
}
func (r LocalRepository) JournalEntry(_ context.Context, id string) (datafabric.JournalEntry, bool, error) {
	entry, exists := r.Store.JournalEntry(id)
	return entry, exists, nil
}
func (r LocalRepository) StartSaga(_ context.Context, instance datafabric.SagaInstance) error {
	return r.Store.StartSaga(instance)
}
func (r LocalRepository) Saga(_ context.Context, id string) (datafabric.SagaInstance, bool, error) {
	instance, exists := r.Store.Saga(id)
	return instance, exists, nil
}
func (r LocalRepository) Sagas(context.Context) ([]datafabric.SagaInstance, error) {
	return r.Store.Sagas(), nil
}
func (r LocalRepository) CompleteSagaStep(_ context.Context, id, eventID string, at time.Time) error {
	return r.Store.CompleteSagaStep(id, eventID, at)
}
func (r LocalRepository) FailSaga(_ context.Context, id, reason string, at time.Time) error {
	return r.Store.FailSaga(id, reason, at)
}
func (r LocalRepository) CompleteSagaCompensation(_ context.Context, id, eventID string, at time.Time) error {
	return r.Store.CompleteSagaCompensation(id, eventID, at)
}
func (r LocalRepository) RequireSagaManualRecovery(_ context.Context, id, reason string, at time.Time) error {
	return r.Store.RequireSagaManualRecovery(id, reason, at)
}
func (r LocalRepository) ReconcileJournal(_ context.Context, runID, entryID, auditID, sourceCommit, sourceRelease string, required []string, observations []datafabric.SettlementObservation, at time.Time) (datafabric.ReconciliationRun, error) {
	return r.Store.ReconcileJournal(runID, entryID, auditID, sourceCommit, sourceRelease, required, observations, at)
}
func (r LocalRepository) Reconciliations(context.Context) ([]datafabric.ReconciliationRun, error) {
	return r.Store.Reconciliations(), nil
}
func (r LocalRepository) ExportSubject(_ context.Context, accountID, version string, at time.Time) (datafabric.SubjectExport, error) {
	return r.Store.ExportSubject(accountID, version, at)
}
func (r LocalRepository) RecordErasure(_ context.Context, accountID, auditID string, key []byte, at time.Time) (datafabric.ErasureRecord, error) {
	return r.Store.RecordErasure(accountID, auditID, key, at)
}
func (r LocalRepository) AuditIntegrity(_ context.Context, keys map[string][]byte) error {
	return r.Store.AuditIntegrity(keys)
}
func (r LocalRepository) Stats(context.Context) (datafabric.StoreStats, error) {
	return r.Store.Stats(), nil
}

var _ Repository = LocalRepository{}
