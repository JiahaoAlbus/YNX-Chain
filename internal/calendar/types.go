package calendar

import "time"

const (
	ProductID     = "com.ynx.calendar"
	RequiredScope = "calendar:account"
	RecoveryScope = "calendar:recover"
)

type WalletProof struct {
	Account   string   `json:"account"`
	Handle    string   `json:"handle"`
	Product   string   `json:"product"`
	Scopes    []string `json:"scopes"`
	Challenge string   `json:"challenge"`
	DeviceKey string   `json:"device_key"`
	ExpiresAt int64    `json:"expires_at"`
	Assertion string   `json:"assertion"`
}
type User struct {
	ID          string    `json:"id"`
	Handle      string    `json:"handle"`
	AccountHash string    `json:"account_hash"`
	CreatedAt   time.Time `json:"created_at"`
	RecoveredAt time.Time `json:"recovered_at,omitempty"`
}
type Challenge struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expires_at"`
	Used      bool      `json:"used"`
}
type Session struct {
	TokenHash string    `json:"token_hash"`
	UserID    string    `json:"user_id"`
	DeviceKey string    `json:"device_key"`
	ExpiresAt time.Time `json:"expires_at"`
	RevokedAt time.Time `json:"revoked_at,omitempty"`
}

type Recurrence struct {
	Frequency string    `json:"frequency"`
	Interval  int       `json:"interval"`
	Count     int       `json:"count"`
	Until     time.Time `json:"until,omitempty"`
}
type Reminder struct {
	ID            string `json:"id"`
	MinutesBefore int    `json:"minutes_before"`
	Channel       string `json:"channel"`
	State         string `json:"state"`
}
type ReminderDelivery struct {
	ID              string    `json:"id"`
	ReminderID      string    `json:"reminder_id"`
	EventID         string    `json:"event_id"`
	OwnerID         string    `json:"owner_id"`
	Title           string    `json:"title"`
	OccurrenceStart time.Time `json:"occurrence_start"`
	DueAt           time.Time `json:"due_at"`
	State           string    `json:"state"`
	DeliveredAt     time.Time `json:"delivered_at"`
}
type Invite struct {
	Handle      string    `json:"handle"`
	State       string    `json:"state"`
	RespondedAt time.Time `json:"responded_at,omitempty"`
}
type Share struct {
	Handle string `json:"handle"`
	Role   string `json:"role"`
}
type Event struct {
	ID          string     `json:"id"`
	OwnerID     string     `json:"owner_id"`
	OwnerHandle string     `json:"owner_handle"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	StartUTC    time.Time  `json:"start_utc"`
	EndUTC      time.Time  `json:"end_utc"`
	TimeZone    string     `json:"time_zone"`
	Recurrence  Recurrence `json:"recurrence,omitempty"`
	Invites     []Invite   `json:"invites,omitempty"`
	Reminders   []Reminder `json:"reminders,omitempty"`
	Shares      []Share    `json:"shares,omitempty"`
	MeetingLink string     `json:"meeting_link,omitempty"`
	State       string     `json:"state"`
	Version     int        `json:"version"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	CancelledAt time.Time  `json:"cancelled_at,omitempty"`
}
type EventInput struct {
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	LocalStart       string     `json:"local_start"`
	LocalEnd         string     `json:"local_end"`
	TimeZone         string     `json:"time_zone"`
	Recurrence       Recurrence `json:"recurrence"`
	Invitees         []string   `json:"invitees"`
	Reminders        []Reminder `json:"reminders"`
	MeetingLink      string     `json:"meeting_link"`
	ClientMutationID string     `json:"client_mutation_id"`
	BaseVersion      int        `json:"base_version"`
}
type Occurrence struct {
	EventID    string    `json:"event_id"`
	Title      string    `json:"title"`
	StartUTC   time.Time `json:"start_utc"`
	EndUTC     time.Time `json:"end_utc"`
	LocalStart string    `json:"local_start"`
	LocalEnd   string    `json:"local_end"`
	TimeZone   string    `json:"time_zone"`
}
type Conflict struct {
	EventID  string    `json:"event_id"`
	Title    string    `json:"title"`
	StartUTC time.Time `json:"start_utc"`
	EndUTC   time.Time `json:"end_utc"`
}
type ChangePreview struct {
	ID               string     `json:"id"`
	EventID          string     `json:"event_id"`
	ActorID          string     `json:"actor_id"`
	Kind             string     `json:"kind"`
	Before           *Event     `json:"before,omitempty"`
	After            Event      `json:"after"`
	Conflicts        []Conflict `json:"conflicts,omitempty"`
	State            string     `json:"state"`
	ClientMutationID string     `json:"client_mutation_id"`
	CreatedAt        time.Time  `json:"created_at"`
	ApprovedAt       time.Time  `json:"approved_at,omitempty"`
	RevertedAt       time.Time  `json:"reverted_at,omitempty"`
}

type AIJob struct {
	ID             string    `json:"id"`
	OwnerID        string    `json:"owner_id"`
	Kind           string    `json:"kind"`
	EventIDs       []string  `json:"event_ids"`
	ContextPreview string    `json:"context_preview"`
	Provider       string    `json:"provider"`
	Model          string    `json:"model"`
	CostEstimate   string    `json:"cost_estimate"`
	State          string    `json:"state"`
	Result         string    `json:"result,omitempty"`
	Error          string    `json:"error,omitempty"`
	ApprovedAt     time.Time `json:"approved_at,omitempty"`
	ReviewedAt     time.Time `json:"reviewed_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
type AuditEntry struct {
	ID        string         `json:"id"`
	ActorID   string         `json:"actor_id"`
	Action    string         `json:"action"`
	TargetID  string         `json:"target_id,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}
type State struct {
	Users              map[string]User             `json:"users"`
	Challenges         map[string]Challenge        `json:"challenges"`
	Sessions           map[string]Session          `json:"sessions"`
	Events             map[string]Event            `json:"events"`
	ReminderDeliveries map[string]ReminderDelivery `json:"reminder_deliveries"`
	Changes            map[string]ChangePreview    `json:"changes"`
	Mutations          map[string]string           `json:"mutations"`
	AIJobs             map[string]AIJob            `json:"ai_jobs"`
	Audit              []AuditEntry                `json:"audit"`
}
