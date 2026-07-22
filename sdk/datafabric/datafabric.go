// Package datafabric is the supported Go SDK facade for YNX Data Fabric.
package datafabric

import (
	"io"
	"time"

	core "github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const EnvelopeSchemaVersion = core.EnvelopeSchemaVersion

var (
	ErrDuplicate  = core.ErrDuplicate
	ErrOutOfOrder = core.ErrOutOfOrder
	ErrTampered   = core.ErrTampered
)

type Actor = core.Actor
type SourceMetadata = core.SourceMetadata
type Integrity = core.Integrity
type EventEnvelope = core.EventEnvelope
type OutboxRecord = core.OutboxRecord
type InboxRecord = core.InboxRecord
type DeadLetter = core.DeadLetter
type Store = core.Store
type StoreStats = core.StoreStats
type ReplayReport = core.ReplayReport
type Publisher = core.Publisher
type Dispatcher = core.Dispatcher
type DispatchReport = core.DispatchReport
type EventLogPublisher = core.EventLogPublisher
type EventLogRecord = core.EventLogRecord
type PostingSide = core.PostingSide
type Posting = core.Posting
type JournalEntry = core.JournalEntry
type FeeConsent = core.FeeConsent
type SagaKind = core.SagaKind
type SagaStatus = core.SagaStatus
type SagaStep = core.SagaStep
type SagaInstance = core.SagaInstance
type SettlementObservation = core.SettlementObservation
type ReconciliationFinding = core.ReconciliationFinding
type ReconciliationRun = core.ReconciliationRun
type SubjectExport = core.SubjectExport
type ErasureRecord = core.ErasureRecord

const (
	Debit  = core.Debit
	Credit = core.Credit

	SagaWalletSession  = core.SagaWalletSession
	SagaPay            = core.SagaPay
	SagaShop           = core.SagaShop
	SagaMerchant       = core.SagaMerchant
	SagaExchange       = core.SagaExchange
	SagaDEX            = core.SagaDEX
	SagaQuant          = core.SagaQuant
	SagaTrust          = core.SagaTrust
	SagaResource       = core.SagaResource
	SagaCloud          = core.SagaCloud
	SagaAI             = core.SagaAI
	SagaMail           = core.SagaMail
	SagaCreatorRevenue = core.SagaCreatorRevenue

	SagaRunning        = core.SagaRunning
	SagaCompensating   = core.SagaCompensating
	SagaCompensated    = core.SagaCompensated
	SagaCompleted      = core.SagaCompleted
	SagaManualRecovery = core.SagaManualRecovery
)

func DecodeEnvelopeStrict(r io.Reader) (EventEnvelope, error) { return core.DecodeEnvelopeStrict(r) }
func OpenStore(path string) (*Store, error)                   { return core.OpenStore(path) }
func NewSaga(id string, kind SagaKind, aggregateID, correlationID, auditID string, now, deadline time.Time) (SagaInstance, error) {
	return core.NewSaga(id, kind, aggregateID, correlationID, auditID, now, deadline)
}
func SupportedSagaKinds() []SagaKind           { return core.SupportedSagaKinds() }
func SagaProduct(kind SagaKind) (string, bool) { return core.SagaProduct(kind) }
