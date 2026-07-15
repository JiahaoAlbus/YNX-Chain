package cloud

import "time"

const (
	ChainID        = "ynx_6423-1"
	EVMChainID     = 6423
	NativeSymbol   = "YNXT"
	MaxUploadBytes = 8 << 20
)

type ObjectKind string

const (
	KindFile   ObjectKind = "file"
	KindFolder ObjectKind = "folder"
	KindDoc    ObjectKind = "doc"
)

type Encryption struct {
	ClientSide     bool   `json:"clientSide"`
	Algorithm      string `json:"algorithm,omitempty"`
	KeyHint        string `json:"keyHint,omitempty"`
	RecoveryPolicy string `json:"recoveryPolicy,omitempty"`
}

type Object struct {
	ID         string     `json:"id"`
	Owner      string     `json:"owner"`
	ParentID   string     `json:"parentId,omitempty"`
	Kind       ObjectKind `json:"kind"`
	Name       string     `json:"name"`
	MIME       string     `json:"mime,omitempty"`
	Size       int64      `json:"size"`
	Hash       string     `json:"hash,omitempty"`
	Version    int        `json:"version"`
	Starred    bool       `json:"starred"`
	TrashedAt  *time.Time `json:"trashedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	Encryption Encryption `json:"encryption"`
	ScanStatus string     `json:"scanStatus,omitempty"`
}

type Version struct {
	ObjectID  string    `json:"objectId"`
	Number    int       `json:"number"`
	Hash      string    `json:"hash"`
	Size      int64     `json:"size"`
	MIME      string    `json:"mime"`
	BlobPath  string    `json:"blobPath"`
	Author    string    `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
}

type Grant struct {
	ID        string     `json:"id"`
	ObjectID  string     `json:"objectId"`
	Principal string     `json:"principal"`
	Role      string     `json:"role"`
	CreatedBy string     `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type ShareLink struct {
	ID        string     `json:"id"`
	ObjectID  string     `json:"objectId"`
	TokenHash string     `json:"-"`
	Role      string     `json:"role"`
	ExpiresAt time.Time  `json:"expiresAt"`
	CreatedBy string     `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type AccessRequest struct {
	ID            string     `json:"id"`
	ObjectID      string     `json:"objectId"`
	Requester     string     `json:"requester"`
	RequestedRole string     `json:"requestedRole"`
	Message       string     `json:"message,omitempty"`
	Status        string     `json:"status"`
	DecidedBy     string     `json:"decidedBy,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	DecidedAt     *time.Time `json:"decidedAt,omitempty"`
}

type Comment struct {
	ID         string     `json:"id"`
	ObjectID   string     `json:"objectId"`
	Version    int        `json:"version"`
	Author     string     `json:"author"`
	Body       string     `json:"body"`
	Mentions   []string   `json:"mentions"`
	CreatedAt  time.Time  `json:"createdAt"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
}

type Presence struct {
	ObjectID  string    `json:"objectId"`
	Actor     string    `json:"actor"`
	Label     string    `json:"label"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type AuditEvent struct {
	ID       string         `json:"id"`
	Actor    string         `json:"actor"`
	Action   string         `json:"action"`
	ObjectID string         `json:"objectId,omitempty"`
	At       time.Time      `json:"at"`
	Details  map[string]any `json:"details,omitempty"`
}

type AIJob struct {
	ID          string     `json:"id"`
	Actor       string     `json:"actor"`
	Mode        string     `json:"mode"`
	ObjectIDs   []string   `json:"objectIds"`
	Versions    []int      `json:"versions"`
	Instruction string     `json:"instruction"`
	Provider    string     `json:"provider"`
	Model       string     `json:"model"`
	Estimate    int        `json:"estimatedUnits"`
	ConsentAt   time.Time  `json:"consentAt"`
	Status      string     `json:"status"`
	Result      string     `json:"result,omitempty"`
	Citations   []string   `json:"citations,omitempty"`
	Error       string     `json:"error,omitempty"`
	AppliedAt   *time.Time `json:"appliedAt,omitempty"`
	RejectedAt  *time.Time `json:"rejectedAt,omitempty"`
}

type Session struct {
	TokenHash string    `json:"tokenHash"`
	Account   string    `json:"account"`
	Product   string    `json:"product"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type persistentState struct {
	SchemaVersion  int                      `json:"schemaVersion"`
	Objects        map[string]Object        `json:"objects"`
	Versions       map[string][]Version     `json:"versions"`
	Grants         map[string]Grant         `json:"grants"`
	Links          map[string]ShareLink     `json:"links"`
	AccessRequests map[string]AccessRequest `json:"accessRequests"`
	Comments       map[string][]Comment     `json:"comments"`
	Presence       map[string]Presence      `json:"presence"`
	AIJobs         map[string]AIJob         `json:"aiJobs"`
	Sessions       map[string]Session       `json:"sessions"`
	Nonces         map[string]time.Time     `json:"nonces"`
	Audit          []AuditEvent             `json:"audit"`
	IntegrityHash  string                   `json:"integrityHash"`
}

type ListOptions struct {
	ParentID string
	Query    string
	View     string
}

type CreateObjectRequest struct {
	ParentID   string     `json:"parentId"`
	Kind       ObjectKind `json:"kind"`
	Name       string     `json:"name"`
	MIME       string     `json:"mime"`
	Content    []byte     `json:"content"`
	Encryption Encryption `json:"encryption"`
}

type SaveDocumentRequest struct {
	BaseVersion int    `json:"baseVersion"`
	Content     []byte `json:"content"`
}

type ConflictError struct{ Current Object }

func (e ConflictError) Error() string { return "document version conflict" }
