package video

import "time"

type Visibility string

const (
	VisibilityPrivate  Visibility = "private"
	VisibilityUnlisted Visibility = "unlisted"
	VisibilityPublic   Visibility = "public"
)

type Video struct {
	ID               string         `json:"id"`
	Owner            string         `json:"owner"`
	ChannelID        string         `json:"channel_id"`
	Title            string         `json:"title"`
	Description      string         `json:"description"`
	OwnedDeclaration bool           `json:"owned_content_declaration"`
	Visibility       Visibility     `json:"visibility"`
	Status           string         `json:"status"`
	Failure          string         `json:"failure,omitempty"`
	OriginalName     string         `json:"original_name"`
	ContentType      string         `json:"content_type"`
	Bytes            int64          `json:"bytes"`
	SHA256           string         `json:"sha256"`
	ObjectKey        string         `json:"object_key"`
	Variants         []MediaVariant `json:"variants,omitempty"`
	ThumbnailKey     string         `json:"thumbnail_key,omitempty"`
	Captions         []CaptionTrack `json:"captions,omitempty"`
	Takedown         *Takedown      `json:"takedown,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	PublishedAt      *time.Time     `json:"published_at,omitempty"`
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
	ID, Owner, VideoID, Kind, State, Provider, Model, Failure string
	ContextClasses                                            []string
	ContextPreview                                            string
	EstimatedUnits                                            int64
	PermissionAt, CreatedAt                                   time.Time
	Result                                                    string
	Partial                                                   string
	ReviewedBy                                                string
	ReviewedAt                                                *time.Time
	Applied                                                   bool
}

type StudioSnapshot struct {
	Videos        []Video         `json:"videos"`
	Analytics     Analytics       `json:"analytics"`
	Reports       []Report        `json:"reports"`
	Monetization  []Monetization  `json:"monetization"`
	Revenue       []RevenueRecord `json:"revenue"`
	PayoutIntents []PayoutIntent  `json:"payout_intents"`
	Disputes      []Dispute       `json:"disputes"`
	Appeals       []Appeal        `json:"appeals"`
	AIJobs        []AIJob         `json:"ai_jobs"`
}

type AuditEvent struct {
	ID, Actor, Action, ObjectType, ObjectID, Detail string
	At                                              time.Time
}

type State struct {
	Videos        map[string]*Video         `json:"videos"`
	Channels      map[string]*Channel       `json:"channels"`
	Subscriptions map[string]Subscription   `json:"subscriptions"`
	Playlists     map[string]*Playlist      `json:"playlists"`
	Comments      map[string]*Comment       `json:"comments"`
	WatchEvents   map[string]WatchEvent     `json:"watch_events"`
	Reports       map[string]*Report        `json:"reports"`
	Appeals       map[string]*Appeal        `json:"appeals"`
	Monetization  map[string]*Monetization  `json:"monetization"`
	PayoutIntents map[string]*PayoutIntent  `json:"payout_intents"`
	Revenue       map[string]*RevenueRecord `json:"revenue"`
	Disputes      map[string]*Dispute       `json:"disputes"`
	AIJobs        map[string]*AIJob         `json:"ai_jobs"`
	Audit         []AuditEvent              `json:"audit"`
}

type Analytics struct {
	Views        int64 `json:"views"`
	WatchSeconds int64 `json:"watch_seconds"`
	Subscribers  int64 `json:"subscribers"`
	RevenueYNXT  int64 `json:"revenue_ynxt"`
}
