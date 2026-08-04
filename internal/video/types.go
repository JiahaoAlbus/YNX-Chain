package video

import "time"

type Visibility string

type WorkflowState string

const (
	VisibilityPrivate  Visibility = "private"
	VisibilityUnlisted Visibility = "unlisted"
	VisibilityPublic   Visibility = "public"

	WorkflowDraft       WorkflowState = "draft"
	WorkflowInReview    WorkflowState = "in_review"
	WorkflowApproved    WorkflowState = "approved"
	WorkflowRejected    WorkflowState = "rejected"
	WorkflowScheduled   WorkflowState = "scheduled"
	WorkflowPublished   WorkflowState = "published"
	WorkflowUnpublished WorkflowState = "unpublished"
)

type Video struct {
	ID                  string         `json:"id"`
	Owner               string         `json:"owner"`
	ChannelID           string         `json:"channel_id"`
	Title               string         `json:"title"`
	Description         string         `json:"description"`
	OwnedDeclaration    bool           `json:"owned_content_declaration"`
	Visibility          Visibility     `json:"visibility"`
	Status              string         `json:"status"`
	WorkflowState       WorkflowState  `json:"workflow_state"`
	Version             uint64         `json:"version"`
	Versions            []VideoVersion `json:"versions,omitempty"`
	ScheduledAt         *time.Time     `json:"scheduled_at,omitempty"`
	ScheduledVisibility Visibility     `json:"scheduled_visibility,omitempty"`
	SubmittedAt         *time.Time     `json:"submitted_at,omitempty"`
	SubmittedBy         string         `json:"submitted_by,omitempty"`
	ReviewedAt          *time.Time     `json:"reviewed_at,omitempty"`
	ReviewedBy          string         `json:"reviewed_by,omitempty"`
	ReviewReason        string         `json:"review_reason,omitempty"`
	Failure             string         `json:"failure,omitempty"`
	OriginalName        string         `json:"original_name"`
	ContentType         string         `json:"content_type"`
	Bytes               int64          `json:"bytes"`
	SHA256              string         `json:"sha256"`
	ObjectKey           string         `json:"object_key"`
	Variants            []MediaVariant `json:"variants,omitempty"`
	ThumbnailKey        string         `json:"thumbnail_key,omitempty"`
	Captions            []CaptionTrack `json:"captions,omitempty"`
	Takedown            *Takedown      `json:"takedown,omitempty"`
	RightsDeclarationID string         `json:"rights_declaration_id,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
	PublishedAt         *time.Time     `json:"published_at,omitempty"`
}

type VideoVersion struct {
	Sequence       uint64        `json:"sequence"`
	Actor          string        `json:"actor"`
	Kind           string        `json:"kind"`
	PreviousState  WorkflowState `json:"previous_state"`
	NextState      WorkflowState `json:"next_state"`
	Title          string        `json:"title"`
	Description    string        `json:"description"`
	Visibility     Visibility    `json:"visibility"`
	ContentSHA256  string        `json:"content_sha256"`
	MetadataSHA256 string        `json:"metadata_sha256"`
	RecordedAt     time.Time     `json:"recorded_at"`
}

type MediaVariant struct {
	Name      string `json:"name"`
	ObjectKey string `json:"object_key"`
	MIME      string `json:"mime"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
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
	SchemaVersion uint64                        `json:"schema_version,omitempty"`
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
	Source         string            `json:"source"`
	AsOf           time.Time         `json:"as_of"`
	Version        string            `json:"version"`
	Coverage       AnalyticsCoverage `json:"coverage"`
	Views          int64             `json:"views"`
	UniqueUsers    int64             `json:"unique_users"`
	CompletedViews int64             `json:"completed_views"`
	WatchSeconds   int64             `json:"watch_seconds"`
	Subscribers    int64             `json:"subscribers"`
	RevenueYNXT    int64             `json:"revenue_ynxt"`
}

type AnalyticsCoverage struct {
	Scope                  string `json:"scope"`
	ChannelCount           int64  `json:"channel_count"`
	VideoCount             int64  `json:"video_count"`
	WatchEventCount        int64  `json:"watch_event_count"`
	SubscriptionEventCount int64  `json:"subscription_event_count"`
	RevenueEventCount      int64  `json:"revenue_event_count"`
	RevenueIncluded        bool   `json:"revenue_included"`
}
