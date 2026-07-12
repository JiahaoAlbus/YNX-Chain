package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	SignedActionVersion = 1
	SignedActionType    = "application_action"
	SignedActionFeeYNXT = int64(1)
	MaxSignedActionSize = 16 * 1024

	ActionAIPermissionCreate = "ai_permission_create"
	ActionAIProposalCreate   = "ai_action_propose"
	ActionAIProposalApprove  = "ai_action_approve"
	ActionAIProposalReject   = "ai_action_reject"
)

var supportedApplicationActions = map[string]struct{}{
	ActionAIPermissionCreate: {},
	ActionAIProposalCreate:   {},
	ActionAIProposalApprove:  {},
	ActionAIProposalReject:   {},
}

// SignedApplicationAction is the canonical transaction envelope for non-transfer
// application state. Payload is canonical typed JSON and is separately hashed.
type SignedApplicationAction struct {
	Version     int             `json:"version"`
	ChainID     int64           `json:"chainId"`
	Type        string          `json:"type"`
	Signer      string          `json:"signer"`
	Nonce       uint64          `json:"nonce"`
	Action      string          `json:"action"`
	Payload     json.RawMessage `json:"payload"`
	PayloadHash string          `json:"payloadHash"`
	Fee         int64           `json:"fee"`
	AIUnits     int64           `json:"aiUnits"`
	PublicKey   string          `json:"publicKey"`
	Signature   string          `json:"signature"`
}

type applicationActionSignDoc struct {
	Domain      string          `json:"domain"`
	Version     int             `json:"version"`
	ChainID     int64           `json:"chainId"`
	Type        string          `json:"type"`
	Signer      string          `json:"signer"`
	Nonce       uint64          `json:"nonce"`
	Action      string          `json:"action"`
	Payload     json.RawMessage `json:"payload"`
	PayloadHash string          `json:"payloadHash"`
	Fee         int64           `json:"fee"`
	AIUnits     int64           `json:"aiUnits"`
	PublicKey   string          `json:"publicKey"`
}

type AIPermissionPayload struct {
	SessionID   string `json:"sessionId"`
	Requester   string `json:"requester"`
	Scope       string `json:"scope"`
	Purpose     string `json:"purpose"`
	ExpiryHours int64  `json:"expiryHours"`
}

type AIActionProposalPayload struct {
	SessionID   string `json:"sessionId"`
	Requester   string `json:"requester"`
	Scope       string `json:"scope"`
	ActionType  string `json:"actionType"`
	Description string `json:"description"`
	ExpiryHours int64  `json:"expiryHours"`
}

type AIActionDecisionPayload struct {
	ActionID     string `json:"actionId"`
	Approver     string `json:"approver"`
	PermissionID string `json:"permissionId,omitempty"`
}

type BFTAIPermission struct {
	ID          string    `json:"id"`
	Signer      string    `json:"signer"`
	SessionID   string    `json:"sessionId"`
	Requester   string    `json:"requester"`
	Scope       string    `json:"scope"`
	Purpose     string    `json:"purpose"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
	BlockHeight int64     `json:"blockHeight"`
	TxHash      string    `json:"txHash"`
	AuditHash   string    `json:"auditHash"`
}

type BFTAIAction struct {
	ID               string     `json:"id"`
	Signer           string     `json:"signer"`
	SessionID        string     `json:"sessionId"`
	Requester        string     `json:"requester"`
	Scope            string     `json:"scope"`
	ActionType       string     `json:"actionType"`
	Description      string     `json:"description"`
	PermissionID     string     `json:"permissionId,omitempty"`
	Status           string     `json:"status"`
	Executable       bool       `json:"executable"`
	Sensitive        bool       `json:"sensitive"`
	RequiresApproval bool       `json:"requiresApproval"`
	Reasons          []string   `json:"reasons"`
	CreatedAt        time.Time  `json:"createdAt"`
	ExpiresAt        time.Time  `json:"expiresAt"`
	ApprovedAt       *time.Time `json:"approvedAt,omitempty"`
	ApprovedBy       string     `json:"approvedBy,omitempty"`
	RejectedAt       *time.Time `json:"rejectedAt,omitempty"`
	RejectedBy       string     `json:"rejectedBy,omitempty"`
	BlockHeight      int64      `json:"blockHeight"`
	TxHash           string     `json:"txHash"`
	AuditHash        string     `json:"auditHash"`
}

type BFTAIAuditEvent struct {
	ID          string    `json:"id"`
	RecordID    string    `json:"recordId"`
	Type        string    `json:"type"`
	Signer      string    `json:"signer"`
	BlockHeight int64     `json:"blockHeight"`
	CreatedAt   time.Time `json:"createdAt"`
	TxHash      string    `json:"txHash"`
	AuditHash   string    `json:"auditHash"`
}

func NewSignedApplicationAction(privateKey *secp256k1.PrivateKey, chainID int64, action string, payload any, nonce uint64) (SignedApplicationAction, error) {
	if privateKey == nil {
		return SignedApplicationAction{}, errors.New("private key is required")
	}
	canonicalPayload, err := canonicalActionPayload(action, payload)
	if err != nil {
		return SignedApplicationAction{}, err
	}
	publicKey := privateKey.PubKey().SerializeCompressed()
	signer, err := NativeAddress(publicKey)
	if err != nil {
		return SignedApplicationAction{}, err
	}
	tx := SignedApplicationAction{
		Version: SignedActionVersion, ChainID: chainID, Type: SignedActionType,
		Signer: signer, Nonce: nonce, Action: action, Payload: canonicalPayload,
		PayloadHash: actionPayloadHash(canonicalPayload), Fee: SignedActionFeeYNXT,
		AIUnits: 1, PublicKey: hex.EncodeToString(publicKey),
	}
	if err := tx.ValidateBasic(); err != nil {
		return SignedApplicationAction{}, err
	}
	signBytes, err := tx.SignBytes()
	if err != nil {
		return SignedApplicationAction{}, err
	}
	digest := sha256.Sum256(signBytes)
	tx.Signature = hex.EncodeToString(ecdsa.Sign(privateKey, digest[:]).Serialize())
	return tx, nil
}

func (tx SignedApplicationAction) SignBytes() ([]byte, error) {
	return json.Marshal(applicationActionSignDoc{
		Domain: "YNX_APPLICATION_ACTION_V1", Version: tx.Version, ChainID: tx.ChainID,
		Type: tx.Type, Signer: tx.Signer, Nonce: tx.Nonce, Action: tx.Action,
		Payload: tx.Payload, PayloadHash: tx.PayloadHash, Fee: tx.Fee,
		AIUnits: tx.AIUnits, PublicKey: tx.PublicKey,
	})
}

func (tx SignedApplicationAction) ValidateBasic() error {
	if tx.Version != SignedActionVersion || tx.Type != SignedActionType {
		return errors.New("unsupported signed application action envelope")
	}
	if tx.ChainID <= 0 || !IsNativeAddress(tx.Signer) || tx.Nonce == 0 {
		return errors.New("signed application action requires positive chain ID and nonce plus canonical signer")
	}
	if _, ok := supportedApplicationActions[tx.Action]; !ok {
		return fmt.Errorf("unsupported application action %q", tx.Action)
	}
	if len(tx.Payload) == 0 || len(tx.Payload) > 8*1024 {
		return errors.New("application action payload must be between 1 and 8192 bytes")
	}
	canonicalPayload, err := canonicalActionPayload(tx.Action, tx.Payload)
	if err != nil || !bytes.Equal(canonicalPayload, tx.Payload) {
		return errors.New("application action payload is not canonical typed JSON")
	}
	if tx.PayloadHash != actionPayloadHash(tx.Payload) {
		return errors.New("application action payload hash mismatch")
	}
	if tx.Fee != SignedActionFeeYNXT || tx.AIUnits != 1 {
		return errors.New("application action must charge exactly 1 YNXT and 1 AI unit")
	}
	publicKey, err := hex.DecodeString(tx.PublicKey)
	if err != nil || len(publicKey) != secp256k1.PubKeyBytesLenCompressed {
		return errors.New("application action public key must be a compressed secp256k1 key")
	}
	if tx.Signature != "" {
		signature, err := hex.DecodeString(tx.Signature)
		if err != nil || len(signature) == 0 {
			return errors.New("application action signature must be hex-encoded DER")
		}
	}
	return nil
}

func (tx SignedApplicationAction) Verify(expectedChainID int64) error {
	if err := tx.ValidateBasic(); err != nil {
		return err
	}
	if tx.ChainID != expectedChainID {
		return fmt.Errorf("application action chain ID %d does not match %d", tx.ChainID, expectedChainID)
	}
	publicKeyBytes, _ := hex.DecodeString(tx.PublicKey)
	derived, err := NativeAddress(publicKeyBytes)
	if err != nil || derived != tx.Signer {
		return errors.New("application action signer does not match its public key")
	}
	if tx.Signature == "" {
		return errors.New("application action signature is required")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("parse application action public key: %w", err)
	}
	signatureBytes, _ := hex.DecodeString(tx.Signature)
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return errors.New("application action signature is invalid or not canonical low-S")
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return errors.New("application action signature is invalid or not canonical low-S")
	}
	signBytes, err := tx.SignBytes()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(signBytes)
	if !signature.Verify(digest[:], publicKey) {
		return errors.New("application action signature verification failed")
	}
	return nil
}

func EncodeSignedApplicationAction(tx SignedApplicationAction) ([]byte, error) {
	if err := tx.Verify(tx.ChainID); err != nil {
		return nil, err
	}
	return json.Marshal(tx)
}

func DecodeSignedApplicationAction(payload []byte) (SignedApplicationAction, error) {
	if len(payload) == 0 || len(payload) > MaxSignedActionSize {
		return SignedApplicationAction{}, fmt.Errorf("signed application action size must be between 1 and %d bytes", MaxSignedActionSize)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var tx SignedApplicationAction
	if err := decoder.Decode(&tx); err != nil {
		return SignedApplicationAction{}, fmt.Errorf("decode signed application action: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return SignedApplicationAction{}, errors.New("signed application action must contain one JSON value")
	}
	canonical, err := json.Marshal(tx)
	if err != nil {
		return SignedApplicationAction{}, err
	}
	if !bytes.Equal(payload, canonical) {
		return SignedApplicationAction{}, errors.New("signed application action encoding is not canonical JSON")
	}
	return tx, nil
}

func TransactionEnvelopeType(payload []byte) (string, error) {
	if len(payload) == 0 || len(payload) > MaxSignedActionSize {
		return "", errors.New("transaction envelope size is invalid")
	}
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", errors.New("transaction envelope is not JSON")
	}
	if envelope.Type != SignedTransactionType && envelope.Type != SignedActionType {
		return "", fmt.Errorf("unsupported transaction envelope type %q", envelope.Type)
	}
	return envelope.Type, nil
}

func ApplicationActionHash(payload []byte) string { return SignedTransactionHash(payload) }

func ApplicationActionRecordID(kind, txHash string) string {
	sum := sha256.Sum256([]byte("YNX_ACTION_RECORD_V1|" + kind + "|" + txHash))
	return hex.EncodeToString(sum[:])[:24]
}

func canonicalActionPayload(action string, value any) ([]byte, error) {
	var raw []byte
	var err error
	if supplied, ok := value.(json.RawMessage); ok {
		raw = supplied
	} else {
		raw, err = json.Marshal(value)
		if err != nil {
			return nil, err
		}
	}
	switch action {
	case ActionAIPermissionCreate:
		var payload AIPermissionPayload
		if err := decodeCanonicalPayload(raw, &payload); err != nil {
			return nil, err
		}
		payload.SessionID, payload.Requester = strings.TrimSpace(payload.SessionID), strings.TrimSpace(payload.Requester)
		payload.Scope, payload.Purpose = strings.ToLower(strings.TrimSpace(payload.Scope)), strings.TrimSpace(payload.Purpose)
		if payload.SessionID == "" || payload.Requester == "" || payload.Scope == "" || payload.Purpose == "" || payload.ExpiryHours < 1 || payload.ExpiryHours > 168 {
			return nil, errors.New("invalid AI permission payload")
		}
		if len(payload.SessionID) > 128 || len(payload.Requester) > 128 || len(payload.Scope) > 128 || len(payload.Purpose) > 1024 {
			return nil, errors.New("AI permission payload field exceeds limit")
		}
		return json.Marshal(payload)
	case ActionAIProposalCreate:
		var payload AIActionProposalPayload
		if err := decodeCanonicalPayload(raw, &payload); err != nil {
			return nil, err
		}
		payload.SessionID, payload.Requester = strings.TrimSpace(payload.SessionID), strings.TrimSpace(payload.Requester)
		payload.Scope, payload.ActionType = strings.ToLower(strings.TrimSpace(payload.Scope)), strings.ToLower(strings.TrimSpace(payload.ActionType))
		payload.Description = strings.TrimSpace(payload.Description)
		if payload.SessionID == "" || payload.Requester == "" || payload.Scope == "" || payload.ActionType == "" || payload.Description == "" || payload.ExpiryHours < 1 || payload.ExpiryHours > 168 {
			return nil, errors.New("invalid AI action proposal payload")
		}
		if len(payload.SessionID) > 128 || len(payload.Requester) > 128 || len(payload.Scope) > 128 || len(payload.ActionType) > 128 || len(payload.Description) > 2048 {
			return nil, errors.New("AI action proposal field exceeds limit")
		}
		return json.Marshal(payload)
	case ActionAIProposalApprove, ActionAIProposalReject:
		var payload AIActionDecisionPayload
		if err := decodeCanonicalPayload(raw, &payload); err != nil {
			return nil, err
		}
		payload.ActionID, payload.Approver, payload.PermissionID = strings.TrimSpace(payload.ActionID), strings.TrimSpace(payload.Approver), strings.TrimSpace(payload.PermissionID)
		if payload.ActionID == "" || payload.Approver == "" || (action == ActionAIProposalApprove && payload.PermissionID == "") {
			return nil, errors.New("invalid AI action decision payload")
		}
		if action == ActionAIProposalReject && payload.PermissionID != "" {
			return nil, errors.New("AI rejection payload must not include permissionId")
		}
		if len(payload.ActionID) > 64 || len(payload.Approver) > 128 || len(payload.PermissionID) > 64 {
			return nil, errors.New("AI action decision field exceeds limit")
		}
		return json.Marshal(payload)
	default:
		return nil, fmt.Errorf("unsupported application action %q", action)
	}
}

func decodeCanonicalPayload(raw []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("payload must contain one JSON value")
	}
	return nil
}

func actionPayloadHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func recordAuditHash(domain string, value any) string {
	payload, _ := json.Marshal(value)
	sum := sha256.Sum256(append([]byte(domain+"|"), payload...))
	return hex.EncodeToString(sum[:])
}

func classifyBFTAIAction(payload AIActionProposalPayload) (bool, []string) {
	joined := strings.ToLower(payload.Scope + " " + payload.ActionType + " " + payload.Description)
	for _, marker := range []string{"transfer", "payment", "private", "evidence", "trust", "label", "wallet", "permission", "export", "delete", "freeze"} {
		if strings.Contains(joined, marker) {
			return true, []string{"sensitive AI action requires explicit scoped permission"}
		}
	}
	return false, []string{"non-sensitive AI action is logged for audit"}
}
