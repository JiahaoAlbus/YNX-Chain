package music

import (
	"errors"
	"net/http"
	"time"
)

var (
	ErrInvalid      = errors.New("invalid music request")
	ErrUnauthorized = errors.New("music access denied")
	ErrNotFound     = errors.New("music record not found")
	ErrConflict     = errors.New("music state conflict")
)

type Config struct {
	StatePath      string
	MediaDir       string
	MaxUploadBytes int64
	AIGatewayURL   string
	AIGatewayKey   string
	HTTPClient     *http.Client
	Now            func() time.Time
}

type Profile struct {
	Account         string    `json:"account"`
	DisplayName     string    `json:"displayName"`
	Bio             string    `json:"bio,omitempty"`
	ExplicitAllowed bool      `json:"explicitAllowed"`
	PrivateHistory  bool      `json:"privateHistory"`
	CreatorStatus   string    `json:"creatorStatus"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type RightsDeclaration struct {
	Basis           string    `json:"basis"`
	Territories     []string  `json:"territories"`
	Licensor        string    `json:"licensor,omitempty"`
	EvidenceRef     string    `json:"evidenceRef"`
	AcceptedAt      time.Time `json:"acceptedAt"`
	DeclarationHash string    `json:"declarationHash"`
}

type Track struct {
	ID             string            `json:"id"`
	Owner          string            `json:"owner"`
	Title          string            `json:"title"`
	ArtistName     string            `json:"artistName"`
	Album          string            `json:"album,omitempty"`
	Description    string            `json:"description,omitempty"`
	Explicit       bool              `json:"explicit"`
	DurationMillis int64             `json:"durationMillis"`
	AudioFile      string            `json:"-"`
	AudioMIME      string            `json:"audioMime"`
	AudioSHA256    string            `json:"audioSha256"`
	ArtworkFile    string            `json:"-"`
	ArtworkMIME    string            `json:"artworkMime,omitempty"`
	ArtworkSHA256  string            `json:"artworkSha256,omitempty"`
	Provenance     map[string]string `json:"provenance"`
	Rights         RightsDeclaration `json:"rights"`
	ReleaseState   string            `json:"releaseState"`
	TakedownReason string            `json:"takedownReason,omitempty"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

type Playlist struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	TrackIDs    []string  `json:"trackIds"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ListenerState struct {
	Account   string            `json:"account"`
	Favorites []string          `json:"favorites"`
	Queue     []string          `json:"queue"`
	Downloads map[string]string `json:"downloads"`
	Positions map[string]int64  `json:"positions"`
	History   []HistoryEntry    `json:"history"`
	UpdatedAt time.Time         `json:"updatedAt"`
}

type HistoryEntry struct {
	TrackID        string    `json:"trackId"`
	PositionMillis int64     `json:"positionMillis"`
	Completed      bool      `json:"completed"`
	At             time.Time `json:"at"`
}

type UsageRecord struct {
	ID             string    `json:"id"`
	TrackID        string    `json:"trackId"`
	Listener       string    `json:"listener"`
	ListenedMillis int64     `json:"listenedMillis"`
	Completed      bool      `json:"completed"`
	SessionRef     string    `json:"sessionRef"`
	RecordedAt     time.Time `json:"recordedAt"`
}

type RevenueAllocation struct {
	ID              string    `json:"id"`
	Creator         string    `json:"creator"`
	UsageRecordIDs  []string  `json:"usageRecordIds"`
	SourceRecord    string    `json:"sourceRecord"`
	Currency        string    `json:"currency"`
	AmountMicros    int64     `json:"amountMicros"`
	CalculationNote string    `json:"calculationNote"`
	CreatedAt       time.Time `json:"createdAt"`
}

type SettlementIntent struct {
	ID           string    `json:"id"`
	Creator      string    `json:"creator"`
	AllocationID string    `json:"allocationId"`
	AmountMicros int64     `json:"amountMicros"`
	Currency     string    `json:"currency"`
	PayTo        string    `json:"payTo"`
	Status       string    `json:"status"`
	ReviewURI    string    `json:"reviewUri"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Case struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	TrackID     string    `json:"trackId,omitempty"`
	OpenedBy    string    `json:"openedBy"`
	Reason      string    `json:"reason"`
	EvidenceRef string    `json:"evidenceRef,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AIProposal struct {
	ID              string    `json:"id"`
	Owner           string    `json:"owner"`
	Kind            string    `json:"kind"`
	Intent          string    `json:"intent"`
	ContextTrackIDs []string  `json:"contextTrackIds"`
	Provider        string    `json:"provider"`
	Model           string    `json:"model"`
	EstimatedUnits  int64     `json:"estimatedUnits"`
	Permission      bool      `json:"permission"`
	Status          string    `json:"status"`
	Result          string    `json:"result,omitempty"`
	AppliedObject   string    `json:"appliedObject,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectID     string    `json:"objectId"`
	Actor        string    `json:"actor"`
	At           time.Time `json:"at"`
	PayloadHash  string    `json:"payloadHash"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

type persistentState struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Profiles      map[string]Profile           `json:"profiles"`
	Tracks        map[string]Track             `json:"tracks"`
	Playlists     map[string]Playlist          `json:"playlists"`
	Listeners     map[string]ListenerState     `json:"listeners"`
	Usage         map[string]UsageRecord       `json:"usage"`
	Allocations   map[string]RevenueAllocation `json:"allocations"`
	Settlements   map[string]SettlementIntent  `json:"settlements"`
	Cases         map[string]Case              `json:"cases"`
	AIProposals   map[string]AIProposal        `json:"aiProposals"`
	Idempotency   map[string]string            `json:"idempotency"`
	Audit         []AuditEvent                 `json:"audit"`
	IntegrityHash string                       `json:"integrityHash"`
}
