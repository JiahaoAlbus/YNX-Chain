package square

import (
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	ErrInvalid      = errors.New("invalid square request")
	ErrUnauthorized = errors.New("square access denied")
	ErrNotFound     = errors.New("square record not found")
	ErrConflict     = errors.New("square state conflict")
)

type Config struct {
	StatePath       string
	APIKey          string
	MaxBodyBytes    int
	RateLimitWindow time.Duration
	RateLimitMax    int
	RemoteDeployed  bool
	Now             func() time.Time
}

type Device struct {
	ID               string    `json:"id"`
	Account          string    `json:"account"`
	SigningPublicKey string    `json:"signingPublicKey"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Post struct {
	ID            string    `json:"id"`
	Author        string    `json:"author"`
	AuthorDevice  string    `json:"authorDevice"`
	Content       string    `json:"content"`
	Tags          []string  `json:"tags,omitempty"`
	Status        string    `json:"status"`
	CommentCount  int       `json:"commentCount"`
	ReactionCount int       `json:"reactionCount"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Comment struct {
	ID           string    `json:"id"`
	PostID       string    `json:"postId"`
	Author       string    `json:"author"`
	AuthorDevice string    `json:"authorDevice"`
	Content      string    `json:"content"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Reaction struct {
	PostID    string    `json:"postId"`
	Account   string    `json:"account"`
	Kind      string    `json:"kind"`
	Active    bool      `json:"active"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Follow struct {
	Follower  string    `json:"follower"`
	Following string    `json:"following"`
	Active    bool      `json:"active"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Profile struct {
	Account     string    `json:"account"`
	Handle      string    `json:"handle,omitempty"`
	DisplayName string    `json:"displayName"`
	Bio         string    `json:"bio"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ProfileView struct {
	Profile
	FollowerCount  int `json:"followerCount"`
	FollowingCount int `json:"followingCount"`
	PostCount      int `json:"postCount"`
}

type Notification struct {
	ID         string     `json:"id"`
	Recipient  string     `json:"recipient"`
	Actor      string     `json:"actor"`
	Kind       string     `json:"kind"`
	TargetType string     `json:"targetType"`
	TargetID   string     `json:"targetId"`
	PostID     string     `json:"postId,omitempty"`
	ReadAt     *time.Time `json:"readAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type Report struct {
	ID             string    `json:"id"`
	Reporter       string    `json:"reporter"`
	TargetType     string    `json:"targetType"`
	TargetID       string    `json:"targetId"`
	Category       string    `json:"category"`
	Detail         string    `json:"detail"`
	EvidenceHashes []string  `json:"evidenceHashes,omitempty"`
	Status         string    `json:"status"`
	AppealRoute    string    `json:"appealRoute"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type RegisterDeviceRequest struct {
	IdempotencyKey   string `json:"idempotencyKey"`
	Account          string `json:"account"`
	DeviceID         string `json:"deviceId"`
	SigningPublicKey string `json:"signingPublicKey"`
	ProofSignature   string `json:"proofSignature"`
}

type CreatePostRequest struct {
	IdempotencyKey string   `json:"idempotencyKey"`
	Content        string   `json:"content"`
	Tags           []string `json:"tags,omitempty"`
}

type CreateCommentRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Content        string `json:"content"`
}

type SetReactionRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Kind           string `json:"kind"`
	Active         bool   `json:"active"`
}

type SetFollowRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Account        string `json:"account"`
	Active         bool   `json:"active"`
}

type SetProfileRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Handle         string `json:"handle"`
	DisplayName    string `json:"displayName"`
	Bio            string `json:"bio"`
}

type ReadNotificationRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
}

type CreateReportRequest struct {
	IdempotencyKey string   `json:"idempotencyKey"`
	TargetType     string   `json:"targetType"`
	TargetID       string   `json:"targetId"`
	Category       string   `json:"category"`
	Detail         string   `json:"detail"`
	EvidenceHashes []string `json:"evidenceHashes,omitempty"`
}

type Result[T any] struct {
	Record   T    `json:"record"`
	Replayed bool `json:"replayed"`
}

type Feed struct {
	Posts      []Post `json:"posts"`
	NextCursor string `json:"nextCursor,omitempty"`
}

type NotificationFeed struct {
	Notifications []Notification `json:"notifications"`
	NextCursor    string         `json:"nextCursor,omitempty"`
	UnreadCount   int            `json:"unreadCount"`
}

type Health struct {
	OK                bool           `json:"ok"`
	Service           string         `json:"service"`
	Persistence       string         `json:"persistence"`
	StateIntegrity    string         `json:"stateIntegrity"`
	NativeIdentity    string         `json:"nativeIdentity"`
	RemoteDeployed    bool           `json:"remoteDeployed"`
	PostCount         int            `json:"postCount"`
	CommentCount      int            `json:"commentCount"`
	ActiveReactions   int            `json:"activeReactions"`
	ActiveFollows     int            `json:"activeFollows"`
	ReportCount       int            `json:"reportCount"`
	ProfileCount      int            `json:"profileCount"`
	NotificationCount int            `json:"notificationCount"`
	RateLimit         string         `json:"rateLimit"`
	TruthfulStatus    string         `json:"truthfulStatus"`
	Build             buildinfo.Info `json:"build"`
}

type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectType   string    `json:"objectType"`
	ObjectID     string    `json:"objectId"`
	Actor        string    `json:"actor"`
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
	Posts         map[string]Post              `json:"posts"`
	Comments      map[string][]Comment         `json:"comments"`
	Reactions     map[string]Reaction          `json:"reactions"`
	Follows       map[string]Follow            `json:"follows"`
	Reports       map[string]Report            `json:"reports"`
	Profiles      map[string]Profile           `json:"profiles"`
	Notifications map[string]Notification      `json:"notifications"`
	Idempotency   map[string]idempotencyRecord `json:"idempotency"`
	Audit         []AuditEvent                 `json:"audit"`
	IntegrityHash string                       `json:"integrityHash"`
}
