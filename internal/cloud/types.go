package cloud

import "time"

const (
	ChainID           = "ynx_6423-1"
	EVMChainID        = 6423
	NativeSymbol      = "YNXT"
	MaxUploadBytes    = 8 << 20
	MaxMultipartBytes = 64 << 20
	MaxMultipartParts = 256
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
	Artifact   *Artifact  `json:"artifact,omitempty"`
}

type Artifact struct {
	Type          string     `json:"type"`
	Product       string     `json:"product"`
	Retention     string     `json:"retention"`
	RetentionEnds *time.Time `json:"retentionEndsAt,omitempty"`
}

type MultipartPart struct {
	Number int    `json:"number"`
	Size   int64  `json:"size"`
	Hash   string `json:"hash"`
	Ref    string `json:"ref"`
}

type MultipartUpload struct {
	ID           string                `json:"id"`
	Owner        string                `json:"owner"`
	ParentID     string                `json:"parentId,omitempty"`
	Name         string                `json:"name"`
	MIME         string                `json:"mime"`
	Encryption   Encryption            `json:"encryption"`
	Artifact     *Artifact             `json:"artifact,omitempty"`
	ExpectedSize int64                 `json:"expectedSize"`
	ExpectedHash string                `json:"expectedHash"`
	Status       string                `json:"status"`
	Parts        map[int]MultipartPart `json:"parts"`
	CreatedAt    time.Time             `json:"createdAt"`
	UpdatedAt    time.Time             `json:"updatedAt"`
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
	TokenHash      string    `json:"tokenHash"`
	SessionBinding string    `json:"sessionBinding"`
	RequestDigest  string    `json:"requestDigest"`
	Account        string    `json:"account"`
	Product        string    `json:"product"`
	ClientID       string    `json:"clientId"`
	BundleID       string    `json:"bundleId"`
	Callback       string    `json:"callback"`
	DeviceKey      string    `json:"deviceKey"`
	Scopes         []string  `json:"scopes"`
	IssuedAt       time.Time `json:"issuedAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

type PendingWalletChallenge struct {
	Challenge GatewayChallenge `json:"challenge"`
	Product   string           `json:"product"`
	Callback  string           `json:"callback"`
	Nonce     string           `json:"nonce"`
	CreatedAt time.Time        `json:"createdAt"`
}

type persistentState struct {
	SchemaVersion    int                               `json:"schemaVersion"`
	Objects          map[string]Object                 `json:"objects"`
	Versions         map[string][]Version              `json:"versions"`
	Grants           map[string]Grant                  `json:"grants"`
	Links            map[string]ShareLink              `json:"links"`
	AccessRequests   map[string]AccessRequest          `json:"accessRequests"`
	Comments         map[string][]Comment              `json:"comments"`
	Presence         map[string]Presence               `json:"presence"`
	AIJobs           map[string]AIJob                  `json:"aiJobs"`
	Sessions         map[string]Session                `json:"sessions"`
	WalletChallenges map[string]PendingWalletChallenge `json:"walletChallenges"`
	Nonces           map[string]time.Time              `json:"nonces"`
	Audit            []AuditEvent                      `json:"audit"`
	MultipartUploads map[string]MultipartUpload        `json:"multipartUploads"`
	IntegrityHash    string                            `json:"integrityHash"`
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
	Artifact   *Artifact  `json:"artifact,omitempty"`
}

type SaveDocumentRequest struct {
	BaseVersion int    `json:"baseVersion"`
	Content     []byte `json:"content"`
}

type ExportFile struct {
	ObjectID string `json:"objectId"`
	Version  int    `json:"version"`
	Path     string `json:"path"`
	Hash     string `json:"sha256"`
	Bytes    int64  `json:"bytes"`
}

type ExportManifest struct {
	SchemaVersion int          `json:"schemaVersion"`
	Authority     string       `json:"authority"`
	Source        string       `json:"source"`
	AsOf          time.Time    `json:"asOf"`
	Owner         string       `json:"owner"`
	Objects       []Object     `json:"objects"`
	Versions      []Version    `json:"versions"`
	Grants        []Grant      `json:"grants"`
	Audit         []AuditEvent `json:"audit"`
	Files         []ExportFile `json:"files"`
}

type ConflictError struct{ Current Object }

func (e ConflictError) Error() string { return "document version conflict" }
