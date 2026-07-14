package chat

import (
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	ErrInvalid      = errors.New("invalid chat request")
	ErrUnauthorized = errors.New("chat access denied")
	ErrNotFound     = errors.New("chat record not found")
	ErrConflict     = errors.New("chat state conflict")
)

type Config struct {
	StatePath          string
	APIKey             string
	MaxCiphertextBytes int
	Now                func() time.Time
}

type Device struct {
	ID                  string    `json:"id"`
	Account             string    `json:"account"`
	SigningPublicKey    string    `json:"signingPublicKey"`
	EncryptionPublicKey string    `json:"encryptionPublicKey"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type Conversation struct {
	ID        string    `json:"id"`
	Members   []string  `json:"members"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Message struct {
	ID             string               `json:"id"`
	ConversationID string               `json:"conversationId"`
	Sender         string               `json:"sender"`
	SenderDeviceID string               `json:"senderDeviceId"`
	Algorithm      string               `json:"algorithm"`
	Nonce          string               `json:"nonce"`
	Ciphertext     string               `json:"ciphertext"`
	CiphertextHash string               `json:"ciphertextHash"`
	CreatedAt      time.Time            `json:"createdAt"`
	DeliveredAt    map[string]time.Time `json:"deliveredAt,omitempty"`
	ReadAt         map[string]time.Time `json:"readAt,omitempty"`
}

type RegisterDeviceRequest struct {
	IdempotencyKey      string `json:"idempotencyKey"`
	Account             string `json:"account"`
	DeviceID            string `json:"deviceId"`
	SigningPublicKey    string `json:"signingPublicKey"`
	EncryptionPublicKey string `json:"encryptionPublicKey"`
	ProofSignature      string `json:"proofSignature"`
}

type CreateConversationRequest struct {
	IdempotencyKey string   `json:"idempotencyKey"`
	Members        []string `json:"members"`
}

type SendMessageRequest struct {
	MessageID  string `json:"messageId"`
	Algorithm  string `json:"algorithm"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type Result[T any] struct {
	Record   T    `json:"record"`
	Replayed bool `json:"replayed"`
}

type Health struct {
	OK                   bool           `json:"ok"`
	Service              string         `json:"service"`
	Persistence          string         `json:"persistence"`
	StateIntegrity       string         `json:"stateIntegrity"`
	NativeAddressDefault bool           `json:"nativeAddressDefault"`
	PlaintextStored      bool           `json:"plaintextStored"`
	DeviceCount          int            `json:"deviceCount"`
	ConversationCount    int            `json:"conversationCount"`
	MessageCount         int            `json:"messageCount"`
	TruthfulStatus       string         `json:"truthfulStatus"`
	Build                buildinfo.Info `json:"build"`
}

type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectType   string    `json:"objectType"`
	ObjectID     string    `json:"objectId"`
	Account      string    `json:"account"`
	At           time.Time `json:"at"`
	PayloadHash  string    `json:"payloadHash"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

type idempotencyRecord struct {
	Action   string `json:"action"`
	Digest   string `json:"digest"`
	ObjectID string `json:"objectId"`
}

type persistentState struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Devices       map[string]Device            `json:"devices"`
	Conversations map[string]Conversation      `json:"conversations"`
	Messages      map[string][]Message         `json:"messages"`
	Idempotency   map[string]idempotencyRecord `json:"idempotency"`
	Audit         []AuditEvent                 `json:"audit"`
	IntegrityHash string                       `json:"integrityHash"`
}
