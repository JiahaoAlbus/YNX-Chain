package video

import "time"

type Visibility string

const (
	VisibilityPrivate  Visibility = "private"
	VisibilityUnlisted Visibility = "unlisted"
	VisibilityPublic   Visibility = "public"
)

type Video struct {
	ID                  string                `json:"id"`
	Owner               string                `json:"owner"`
	ChannelID           string                `json:"channel_id"`
	Title               string                `json:"title"`
	Description         string                `json:"description"`
	OwnedDeclaration    bool                  `json:"owned_content_declaration"`
	Visibility          Visibility            `json:"visibility"`
	Status              string                `json:"status"`
	Failure             string                `json:"failure,omitempty"`
	OriginalName        string                `json:"original_name"`
	ContentType         string                `json:"content_type"`
	Bytes               int64                 `json:"bytes"`
	SHA256              string                `json:"sha256"`
	Rights              *UploadRightsEvidence `json:"rights,omitempty"`
	RightsDeclarationID string                `json:"rights_declaration_id,omitempty"`
	Probe               *MediaProbe           `json:"probe,omitempty"`
	ObjectKey           string                `json:"object_key"`
	Variants            []MediaVariant        `json:"variants,omitempty"`
	ThumbnailKey        string                `json:"thumbnail_key,omitempty"`
	Captions            []CaptionTrack        `json:"captions,omitempty"`
	Takedown            *Takedown             `json:"takedown,omitempty"`
	CreatedAt           time.Time             `json:"created_at"`
	UpdatedAt           time.Time             `json:"updated_at"`
	PublishedAt         *time.Time            `json:"published_at,omitempty"`
}

type UploadRightsEvidence struct {
	Basis          string     `json:"basis"`
	Source         string     `json:"source"`
	License        string     `json:"license"`
	Territories    []string   `json:"territories"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	EvidenceSHA256 string     `json:"evidence_sha256"`
}

type MediaProbe struct {
	Container      string  `json:"container"`
	VideoCodec     string  `json:"video_codec"`
	AudioCodec     string  `json:"audio_codec,omitempty"`
	DurationSecond float64 `json:"duration_seconds"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	FrameRate      float64 `json:"frame_rate"`
}

type MediaVariant struct {
	Name            string `json:"name"`
	ObjectKey       string `json:"object_key"`
	MIME            string `json:"mime"`
	Width           int    `json:"width,omitempty"`
	Height          int    `json:"height,omitempty"`
	Bytes           int64  `json:"bytes"`
	SHA256          string `json:"sha256"`
	Lineage         string `json:"lineage"`
	SourceObjectKey string `json:"source_object_key,omitempty"`
	SourceSHA256    string `json:"source_sha256,omitempty"`
}
type CaptionTrack struct {
	Language      string `json:"language"`
	Label         string `json:"label"`
	ObjectKey     string `json:"object_key"`
	AIProposed    bool   `json:"ai_proposed"`
	HumanApproved bool   `json:"human_approved"`
}
type Takedown struct {
	State    string    `json:"state"`
	Reason   string    `json:"reason"`
	Reviewer string    `json:"reviewer"`
	At       time.Time `json:"at"`
}

type Channel struct {
	ID, Owner, Handle, Name, Description string
	CreatedAt                            time.Time
	AuthVersion                          uint64 `json:"auth_version,omitempty"`
}

type CreatorRole string

const (
	CreatorRoleOwner     CreatorRole = "owner"
	CreatorRoleEditor    CreatorRole = "editor"
	CreatorRoleUploader  CreatorRole = "uploader"
	CreatorRoleAnalyst   CreatorRole = "analyst"
	CreatorRoleFinance   CreatorRole = "finance"
	CreatorRoleModerator CreatorRole = "moderator"
	CreatorRoleViewer    CreatorRole = "viewer"
)

type TeamInvite struct {
	ID         string      `json:"id"`
	ChannelID  string      `json:"channel_id"`
	Account    string      `json:"account"`
	InvitedBy  string      `json:"invited_by"`
	State      string      `json:"state"`
	Role       CreatorRole `json:"role"`
	CreatedAt  time.Time   `json:"created_at"`
	ExpiresAt  time.Time   `json:"expires_at"`
	AcceptedAt *time.Time  `json:"accepted_at,omitempty"`
	RevokedAt  *time.Time  `json:"revoked_at,omitempty"`
}

type TeamMember struct {
	ChannelID string      `json:"channel_id"`
	Account   string      `json:"account"`
	GrantedBy string      `json:"granted_by"`
	State     string      `json:"state"`
	Role      CreatorRole `json:"role"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
	RevokedAt *time.Time  `json:"revoked_at,omitempty"`
}

type TeamSnapshot struct {
	ChannelID   string       `json:"channel_id"`
	AuthVersion uint64       `json:"auth_version"`
	Members     []TeamMember `json:"members"`
	Invites     []TeamInvite `json:"invites,omitempty"`
}

type ContributorSplit struct {
	Account     string `json:"account"`
	BasisPoints int64  `json:"basis_points"`
}

type RightsDeclaration struct {
	ID                string             `json:"id"`
	VideoID           string             `json:"video_id"`
	DeclaredBy        string             `json:"declared_by"`
	Basis             string             `json:"basis"`
	LicenseReference  string             `json:"license_reference,omitempty"`
	Territories       []string           `json:"territories"`
	StartsAt          *time.Time         `json:"starts_at,omitempty"`
	EndsAt            *time.Time         `json:"ends_at,omitempty"`
	Exclusive         bool               `json:"exclusive"`
	ContributorSplits []ContributorSplit `json:"contributor_splits"`
	EvidenceSHA256    string             `json:"evidence_sha256"`
	SourceSHA256      string             `json:"source_sha256"`
	State             string             `json:"state"`
	Reviewer          string             `json:"reviewer,omitempty"`
	ReviewReason      string             `json:"review_reason,omitempty"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
}

type ChannelView struct {
	Channel     Channel `json:"channel"`
	Videos      []Video `json:"videos"`
	Subscribers int64   `json:"subscribers"`
}
type Subscription struct {
	Account, ChannelID string
	CreatedAt          time.Time
}
type Playlist struct {
	ID, Owner, Name      string
	VideoIDs             []string
	CreatedAt, UpdatedAt time.Time
}
type Comment struct {
	ID, VideoID, Author, Body, State string
	CreatedAt                        time.Time
}
type WatchEvent struct {
	ID, VideoID, Account string
	Seconds              int64
	Completed            bool
	CreatedAt            time.Time
}
type Report struct {
	ID, VideoID, Reporter, Reason, Details, State string
	CreatedAt, UpdatedAt                          time.Time
}
type Appeal struct {
	ID, ReportID, VideoID, Appellant, Reason, State string
	CreatedAt, UpdatedAt                            time.Time
}

type Monetization struct {
	VideoID, Owner, State, Reason string
	RequestedAt, ReviewedAt       *time.Time
}
type PayoutIntent struct {
	ID, Owner, PayIntentID, State string
	AmountYNXT                    int64
	UsageEventIDs                 []string
	CreatedAt                     time.Time
}
type RevenueRecord struct {
	ID, VideoID, Owner, PayReceiptID string
	AmountYNXT                       int64
	UsageEventIDs                    []string
	CreatedAt                        time.Time
}
type Dispute struct {
	ID, Owner, RevenueRecordID, Reason, State string
	CreatedAt, UpdatedAt                      time.Time
}

type AIJob struct {
	ID, Owner, VideoID, Kind, State, Provider, Model, Failure, OutputLanguage string
	ContextClasses                                                            []string
	ContextPreview                                                            string
	EstimatedUnits                                                            int64
	PermissionAt, CreatedAt                                                   time.Time
	Result                                                                    string
	Partial                                                                   string
	ReviewedBy                                                                string
	ReviewedAt                                                                *time.Time
	Accepted                                                                  bool
}

type IdempotencyRecord struct {
	Actor, Key, Method, Path, RequestHash, State string
	Status                                       int
	ContentType, ResponseBody                    string
	CreatedAt, CompletedAt                       time.Time
}

type StudioSnapshot struct {
	Videos        []Video             `json:"videos"`
	Analytics     Analytics           `json:"analytics"`
	Reports       []Report            `json:"reports"`
	Monetization  []Monetization      `json:"monetization"`
	Revenue       []RevenueRecord     `json:"revenue"`
	PayoutIntents []PayoutIntent      `json:"payout_intents"`
	Disputes      []Dispute           `json:"disputes"`
	Appeals       []Appeal            `json:"appeals"`
	AIJobs        []AIJob             `json:"ai_jobs"`
	Team          []TeamSnapshot      `json:"team"`
	Rights        []RightsDeclaration `json:"rights"`
}

type AuditEvent struct {
	ID, Actor, Action, ObjectType, ObjectID, Detail string
	At                                              time.Time
	Sequence                                        uint64 `json:"sequence"`
	PayloadHash                                     string `json:"payload_hash,omitempty"`
	PreviousHash                                    string `json:"previous_hash,omitempty"`
	Hash                                            string `json:"hash,omitempty"`
}

type GatewayNonce struct {
	Nonce, SessionBinding, RequestHash string
	ConsumedAt                         time.Time
}

type State struct {
	SchemaVersion int                           `json:"schema_version,omitempty"`
	Videos        map[string]*Video             `json:"videos"`
	Channels      map[string]*Channel           `json:"channels"`
	Subscriptions map[string]Subscription       `json:"subscriptions"`
	Playlists     map[string]*Playlist          `json:"playlists"`
	Comments      map[string]*Comment           `json:"comments"`
	WatchEvents   map[string]WatchEvent         `json:"watch_events"`
	Reports       map[string]*Report            `json:"reports"`
	Appeals       map[string]*Appeal            `json:"appeals"`
	Monetization  map[string]*Monetization      `json:"monetization"`
	PayoutIntents map[string]*PayoutIntent      `json:"payout_intents"`
	Revenue       map[string]*RevenueRecord     `json:"revenue"`
	Disputes      map[string]*Dispute           `json:"disputes"`
	AIJobs        map[string]*AIJob             `json:"ai_jobs"`
	Audit         []AuditEvent                  `json:"audit"`
	GatewayNonces map[string]GatewayNonce       `json:"gateway_nonces"`
	Idempotency   map[string]IdempotencyRecord  `json:"idempotency"`
	TeamInvites   map[string]*TeamInvite        `json:"team_invites,omitempty"`
	TeamMembers   map[string]*TeamMember        `json:"team_members,omitempty"`
	Rights        map[string]*RightsDeclaration `json:"rights,omitempty"`
	Integrity     string                        `json:"integrity,omitempty"`
}

type Analytics struct {
	Views        int64 `json:"views"`
	WatchSeconds int64 `json:"watch_seconds"`
	Subscribers  int64 `json:"subscribers"`
	RevenueYNXT  int64 `json:"revenue_ynxt"`
}
