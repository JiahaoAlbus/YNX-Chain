// Package developerauthority owns only developer project/team/release metadata.
// It never creates an account, invents a device grant or promotes a file role.
package developerauthority

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrDenied = errors.New("original developer authority denied")
var ErrConflict = errors.New("original developer command conflicts; do not replay")
var ErrUnknown = errors.New("original developer result unconfirmed; observe original only")

// Values below are internal server bindings, not JSON authority or HTTP roles.
// OriginalSource must be the normal original Auth/native verifier, not a
// renderer/provider/caller callback. No default/fake implementation is offered.
type Principal struct {
	Account, DeviceID, SessionRef, CurrentRef string
	AccountGeneration, SessionGeneration      uint64
	ExpiresMS                                 int64
}
type Approval struct {
	PrincipalSHA256, BindingSHA256, ProofSHA256, ConfirmationRef, RevocationRef string
	ExpiresMS                                                                   int64
}
type ProtectedPublisher struct {
	Account, ProjectID, PublisherID, KeyRole, PublicSHA256, RegistrationRef string
	ExpiresMS                                                               int64
}
type OriginalSource interface {
	AssertSourceCurrent(context.Context) error
	CurrentExistingPrincipal(context.Context, *http.Request) (Principal, error)
	AuthorizeProjectControl(context.Context, Principal, Command, []byte) (Approval, error)
	AssertPrincipalCurrent(context.Context, Principal) error
	AssertCatalogAuthorityCurrent(context.Context, Principal) error
	AssertControlCurrent(context.Context, Principal, Approval) error
	VerifyProtectedPublisherOriginal(context.Context, Principal, Command, []byte) (ProtectedPublisher, error)
	AssertPublisherCurrent(context.Context, Principal, Publisher) error
}

// Existing ordinary login alone does not satisfy AuthorizeProjectControl.
// Confirmation is original explicit approval of THIS entire command/current
// principal/object/action/expected revision/expiry. No new signature domain.
type Command struct {
	RequestID, Action, ProjectID, TeamID, SubjectAccount, PublisherID, RuntimeOrigin string
	ExpectedRevision                                                                 uint64
	GrantExpiresMS                                                                   int64
	Read, Publish, Runtime, Revoke                                                   bool
	ExpiresMS                                                                        int64
	PublicOriginalSHA256                                                             string
}
type ControlResult struct {
	RequestID, Account, Action, ObjectID, BindingSHA256 string
	Revision                                            uint64
	Committed                                           bool
}
type Publisher struct {
	Account, ProjectID, PublisherID, KeyRole, PublicSHA256, RegistrationRef string
	PublicOriginal                                                          []byte
	Revision                                                                uint64
	ExpiresMS                                                               int64
	Revoked                                                                 bool
}
type Access struct {
	Principal                                                Principal
	ProjectID, OwnerAccount, RuntimeOrigin, CurrentReference string
	ProjectRevision                                          uint64
	CatalogRevision                                          uint64
	Read, Publish, Runtime                                   bool
	ExpiresMS                                                int64
}
type grantRow struct {
	Kind, ID                     string
	Revision, MembershipRevision uint64
	Read, Publish, Runtime       bool
	ExpiresMS                    int64
}
type Catalog struct {
	db     *sql.DB
	source OriginalSource
	now    func() time.Time
}

func NewCatalog(db *sql.DB, source OriginalSource) (*Catalog, error) {
	if db == nil || source == nil {
		return nil, ErrDenied
	}
	return &Catalog{db: db, source: source, now: time.Now}, nil
}
func hash(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
func objectHash(v any) string {
	b, e := json.Marshal(v)
	if e != nil {
		return ""
	}
	return hash(b)
}
func text(s string) bool {
	if s == "" || len(s) > 256 || strings.TrimSpace(s) != s {
		return false
	}
	for _, r := range s {
		if r < 33 || r == 127 {
			return false
		}
	}
	return true
}
func principalValid(p Principal, now int64) bool {
	return text(p.Account) && text(p.DeviceID) && text(p.SessionRef) && text(p.CurrentRef) && p.AccountGeneration > 0 && p.SessionGeneration > 0 && p.ExpiresMS > now
}
func canonicalOrigin(s string) bool {
	u, e := url.Parse(s)
	return e == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.Opaque == "" && u.String() == s
}
func (c Command) objectID() string {
	if strings.HasPrefix(c.Action, "team.") {
		return c.TeamID
	}
	return c.ProjectID
}
func (c Command) valid(now int64) bool {
	if !text(c.RequestID) || !text(c.objectID()) || c.ExpiresMS <= now || c.ExpiresMS-now > 300000 || c.ExpectedRevision > 1<<62 {
		return false
	}
	if c.Action == "team.member" || c.Action == "project.member" || c.Action == "project.team" || c.Action == "project.publisher" {
		if (!c.Revoke && c.GrantExpiresMS <= now) || (c.Revoke && c.GrantExpiresMS != 0) {
			return false
		}
	} else if c.GrantExpiresMS != 0 {
		return false
	}
	switch c.Action {
	case "project.create":
		return c.ExpectedRevision == 0 && c.TeamID == "" && c.SubjectAccount == "" && !c.Read && !c.Publish && !c.Runtime && !c.Revoke && c.PublisherID == "" && c.RuntimeOrigin == "" && c.PublicOriginalSHA256 == ""
	case "team.create":
		return c.ExpectedRevision == 0 && c.ProjectID == "" && c.SubjectAccount == "" && !c.Read && !c.Publish && !c.Runtime && !c.Revoke && c.PublisherID == "" && c.RuntimeOrigin == "" && c.PublicOriginalSHA256 == ""
	case "team.member":
		return text(c.SubjectAccount) && c.ProjectID == "" && !c.Read && !c.Publish && !c.Runtime && c.PublisherID == "" && c.RuntimeOrigin == "" && c.PublicOriginalSHA256 == ""
	case "project.member":
		return text(c.SubjectAccount) && c.TeamID == "" && c.PublisherID == "" && c.RuntimeOrigin == "" && c.PublicOriginalSHA256 == "" && (c.Revoke || c.Read || c.Publish || c.Runtime)
	case "project.team":
		return text(c.TeamID) && c.SubjectAccount == "" && c.PublisherID == "" && c.RuntimeOrigin == "" && c.PublicOriginalSHA256 == "" && (c.Revoke || c.Read || c.Publish || c.Runtime)
	case "project.origin":
		return c.ExpectedRevision > 0 && canonicalOrigin(c.RuntimeOrigin) && c.TeamID == "" && c.SubjectAccount == "" && c.PublisherID == "" && !c.Read && !c.Publish && !c.Runtime && !c.Revoke && c.PublicOriginalSHA256 == ""
	case "project.revoke", "team.revoke":
		return c.ExpectedRevision > 0 && c.Revoke && c.SubjectAccount == "" && c.PublisherID == "" && !c.Read && !c.Publish && !c.Runtime && c.PublicOriginalSHA256 == "" && c.RuntimeOrigin == "" && ((c.Action == "project.revoke" && c.TeamID == "") || (c.Action == "team.revoke" && c.ProjectID == ""))
	case "project.publisher":
		b, e := hex.DecodeString(c.PublicOriginalSHA256)
		return e == nil && len(b) == 32 && hex.EncodeToString(b) == c.PublicOriginalSHA256 && text(c.SubjectAccount) && text(c.PublisherID) && c.TeamID == "" && c.RuntimeOrigin == "" && !c.Read && !c.Publish && !c.Runtime
	}
	return false
}
func validApproval(a Approval, p Principal, cmd Command, proof []byte, now int64) bool {
	return a.PrincipalSHA256 == objectHash(p) && a.BindingSHA256 == objectHash(cmd) && a.ProofSHA256 == hash(proof) && text(a.ConfirmationRef) && text(a.RevocationRef) && a.ExpiresMS > now && a.ExpiresMS <= cmd.ExpiresMS && a.ExpiresMS <= p.ExpiresMS
}

// Atomic CAS control writes use the existing deployment's supplied PostgreSQL
// pool. Multi-process uniqueness/transactions are DB-owned, never an in-memory
// registry. Migration/DB provisioning are explicit separate owner actions.
func (c *Catalog) ApplyControl(ctx context.Context, request *http.Request, cmd Command, proof, publicOriginal []byte) (*ControlResult, error) {
	now := c.now().UnixMilli()
	if ctx == nil || request == nil || !cmd.valid(now) || len(proof) == 0 || len(proof) > 65536 {
		return nil, ErrDenied
	}
	proof = append([]byte(nil), proof...)
	publicOriginal = append([]byte(nil), publicOriginal...)
	p, e := c.source.CurrentExistingPrincipal(ctx, request)
	if e != nil || !principalValid(p, now) {
		return nil, ErrDenied
	}
	a, e := c.source.AuthorizeProjectControl(ctx, p, cmd, append([]byte(nil), proof...))
	if e != nil || !validApproval(a, p, cmd, proof, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	var key ProtectedPublisher
	if cmd.Action == "project.publisher" && !cmd.Revoke {
		if len(publicOriginal) == 0 || len(publicOriginal) > 65536 || hash(publicOriginal) != cmd.PublicOriginalSHA256 {
			return nil, ErrDenied
		}
		key, e = c.source.VerifyProtectedPublisherOriginal(ctx, p, cmd, append([]byte(nil), publicOriginal...))
		if e != nil || key.Account != cmd.SubjectAccount || key.ProjectID != cmd.ProjectID || key.PublisherID != cmd.PublisherID || key.KeyRole != "ide-artifact-publisher" || key.PublicSHA256 != cmd.PublicOriginalSHA256 || !text(key.RegistrationRef) || key.ExpiresMS < cmd.GrantExpiresMS {
			return nil, ErrDenied
		}
	} else if len(publicOriginal) != 0 {
		return nil, ErrDenied
	}
	tx, e := c.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var catalogRevision uint64
	if e = tx.QueryRowContext(ctx, "SELECT revision FROM developer_catalog_current WHERE singleton=1 FOR UPDATE").Scan(&catalogRevision); e != nil || catalogRevision == 0 {
		return nil, ErrDenied
	}
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", cmd.objectID()); e != nil {
		return nil, e
	}
	if cmd.Action != "project.create" && cmd.Action != "team.create" {
		table := "developer_projects"
		if strings.HasPrefix(cmd.Action, "team.") {
			table = "developer_teams"
		}
		var owner string
		var revoked bool
		if e = tx.QueryRowContext(ctx, "SELECT owner_account,revoked FROM "+table+" WHERE id=$1 FOR UPDATE", cmd.objectID()).Scan(&owner, &revoked); e != nil || revoked || owner != p.Account {
			return nil, ErrDenied
		}
	}
	if cmd.Action == "team.member" || cmd.Action == "project.member" || cmd.Action == "project.team" || cmd.Action == "project.publisher" {
		table, left, right := "developer_team_members", "team_id", "account"
		first, second := cmd.TeamID, cmd.SubjectAccount
		switch cmd.Action {
		case "project.member":
			table, left, right = "developer_project_members", "project_id", "account"
			first = cmd.ProjectID
		case "project.team":
			table, left, right = "developer_project_teams", "project_id", "team_id"
			first, second = cmd.ProjectID, cmd.TeamID
		case "project.publisher":
			table, left, right = "developer_publishers", "project_id", "publisher_id"
			first, second = cmd.ProjectID, cmd.PublisherID
		}
		var old uint64
		e = tx.QueryRowContext(ctx, "SELECT revision FROM "+table+" WHERE "+left+"=$1 AND "+right+"=$2 FOR UPDATE", first, second).Scan(&old)
		if e == sql.ErrNoRows {
			if cmd.ExpectedRevision != 0 || cmd.Revoke {
				return nil, ErrConflict
			}
		} else if e != nil {
			return nil, e
		} else if old != cmd.ExpectedRevision {
			return nil, ErrConflict
		}
	}
	principalRaw, _ := json.Marshal(p)
	commandRaw, _ := json.Marshal(cmd)
	res, e := tx.ExecContext(ctx, "INSERT INTO developer_control_operations(account,request_id,binding_sha256,proof_sha256,confirmation_ref,revocation_ref,principal_original,command_original,action,object_id,state,revision,expires_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'committed',$11,$12) ON CONFLICT DO NOTHING", p.Account, cmd.RequestID, a.BindingSHA256, a.ProofSHA256, a.ConfirmationRef, a.RevocationRef, principalRaw, commandRaw, cmd.Action, cmd.objectID(), cmd.ExpectedRevision+1, cmd.ExpiresMS)
	if e != nil {
		return nil, e
	}
	n, e := res.RowsAffected()
	if e != nil {
		return nil, e
	}
	if n != 1 {
		return nil, ErrConflict
	}
	switch cmd.Action {
	case "project.create":
		res, e = tx.ExecContext(ctx, "INSERT INTO developer_projects(id,owner_account,revision,revoked) VALUES($1,$2,1,false) ON CONFLICT DO NOTHING", cmd.ProjectID, p.Account)
	case "team.create":
		res, e = tx.ExecContext(ctx, "INSERT INTO developer_teams(id,owner_account,revision,revoked) VALUES($1,$2,1,false) ON CONFLICT DO NOTHING", cmd.TeamID, p.Account)
	case "project.origin":
		res, e = tx.ExecContext(ctx, "UPDATE developer_projects SET runtime_origin=$1,revision=revision+1 WHERE id=$2 AND revision=$3 AND revoked=false", cmd.RuntimeOrigin, cmd.ProjectID, cmd.ExpectedRevision)
	case "project.revoke":
		res, e = tx.ExecContext(ctx, "UPDATE developer_projects SET revoked=true,revision=revision+1 WHERE id=$1 AND revision=$2 AND revoked=false", cmd.ProjectID, cmd.ExpectedRevision)
	case "team.revoke":
		res, e = tx.ExecContext(ctx, "UPDATE developer_teams SET revoked=true,revision=revision+1 WHERE id=$1 AND revision=$2 AND revoked=false", cmd.TeamID, cmd.ExpectedRevision)
	case "team.member":
		res, e = tx.ExecContext(ctx, "INSERT INTO developer_team_members(team_id,account,revision,expires_ms,revoked) VALUES($1,$2,1,$3,$4) ON CONFLICT(team_id,account) DO UPDATE SET revision=developer_team_members.revision+1,expires_ms=EXCLUDED.expires_ms,revoked=EXCLUDED.revoked WHERE developer_team_members.revision=$5", cmd.TeamID, cmd.SubjectAccount, cmd.GrantExpiresMS, cmd.Revoke, cmd.ExpectedRevision)
	case "project.member":
		res, e = tx.ExecContext(ctx, "INSERT INTO developer_project_members(project_id,account,can_read,can_publish,can_runtime,revision,expires_ms,revoked) VALUES($1,$2,$3,$4,$5,1,$6,$7) ON CONFLICT(project_id,account) DO UPDATE SET can_read=EXCLUDED.can_read,can_publish=EXCLUDED.can_publish,can_runtime=EXCLUDED.can_runtime,revision=developer_project_members.revision+1,expires_ms=EXCLUDED.expires_ms,revoked=EXCLUDED.revoked WHERE developer_project_members.revision=$8", cmd.ProjectID, cmd.SubjectAccount, cmd.Read, cmd.Publish, cmd.Runtime, cmd.GrantExpiresMS, cmd.Revoke, cmd.ExpectedRevision)
	case "project.team":
		res, e = tx.ExecContext(ctx, "INSERT INTO developer_project_teams(project_id,team_id,can_read,can_publish,can_runtime,revision,expires_ms,revoked) VALUES($1,$2,$3,$4,$5,1,$6,$7) ON CONFLICT(project_id,team_id) DO UPDATE SET can_read=EXCLUDED.can_read,can_publish=EXCLUDED.can_publish,can_runtime=EXCLUDED.can_runtime,revision=developer_project_teams.revision+1,expires_ms=EXCLUDED.expires_ms,revoked=EXCLUDED.revoked WHERE developer_project_teams.revision=$8", cmd.ProjectID, cmd.TeamID, cmd.Read, cmd.Publish, cmd.Runtime, cmd.GrantExpiresMS, cmd.Revoke, cmd.ExpectedRevision)
	case "project.publisher":
		if cmd.Revoke {
			res, e = tx.ExecContext(ctx, "UPDATE developer_publishers SET revoked=true,revision=revision+1 WHERE project_id=$1 AND publisher_id=$2 AND account=$3 AND public_sha256=$4 AND revision=$5", cmd.ProjectID, cmd.PublisherID, cmd.SubjectAccount, cmd.PublicOriginalSHA256, cmd.ExpectedRevision)
		} else {
			res, e = tx.ExecContext(ctx, "INSERT INTO developer_publishers(project_id,publisher_id,account,key_role,public_original,public_sha256,registration_ref,revision,expires_ms,revoked) VALUES($1,$2,$3,'ide-artifact-publisher',$4,$5,$6,1,$7,$8) ON CONFLICT(project_id,publisher_id) DO UPDATE SET account=EXCLUDED.account,public_original=EXCLUDED.public_original,public_sha256=EXCLUDED.public_sha256,registration_ref=EXCLUDED.registration_ref,revision=developer_publishers.revision+1,expires_ms=EXCLUDED.expires_ms,revoked=EXCLUDED.revoked WHERE developer_publishers.revision=$9", cmd.ProjectID, cmd.PublisherID, cmd.SubjectAccount, append([]byte(nil), publicOriginal...), key.PublicSHA256, key.RegistrationRef, cmd.GrantExpiresMS, false, cmd.ExpectedRevision)
		}
	}
	if e != nil {
		return nil, e
	}
	n, e = res.RowsAffected()
	if e != nil {
		return nil, e
	}
	if n != 1 {
		return nil, ErrConflict
	}
	if _, e = tx.ExecContext(ctx, "UPDATE developer_catalog_current SET revision=revision+1 WHERE singleton=1"); e != nil {
		return nil, e
	}
	if e = c.source.AssertControlCurrent(ctx, p, a); e != nil || !validApproval(a, p, cmd, proof, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	result := &ControlResult{cmd.RequestID, p.Account, cmd.Action, cmd.objectID(), a.BindingSHA256, cmd.ExpectedRevision + 1, true}
	if e = tx.Commit(); e != nil {
		result.Committed = false
		return result, errors.Join(ErrUnknown, e)
	}
	if e = c.source.AssertControlCurrent(ctx, p, a); e != nil || !validApproval(a, p, cmd, proof, c.now().UnixMilli()) {
		return result, ErrUnknown
	}
	return result, nil
}

// Pure projection from authoritative current rows. Ownership/admin never
// implicitly grants read/publish/runtime. Expiry is fixed and never refreshed.
func projectAccess(p Principal, id, owner, origin string, revision, catalogRevision uint64, rows []grantRow, now int64) (Access, error) {
	if !principalValid(p, now) || !text(id) || !text(owner) || revision == 0 || catalogRevision == 0 || len(rows) > 256 || (origin != "" && !canonicalOrigin(origin)) {
		return Access{}, ErrDenied
	}
	a := Access{Principal: p, ProjectID: id, OwnerAccount: owner, RuntimeOrigin: origin, ProjectRevision: revision, CatalogRevision: catalogRevision, ExpiresMS: p.ExpiresMS}
	seen := map[string]bool{}
	for _, r := range rows {
		if (r.Kind != "direct" && r.Kind != "team") || !text(r.ID) || (r.Kind == "direct" && (r.ID != p.Account || r.MembershipRevision != 0)) || (r.Kind == "team" && r.MembershipRevision == 0) || seen[r.Kind+":"+r.ID] {
			return Access{}, ErrDenied
		}
		seen[r.Kind+":"+r.ID] = true
		if r.ExpiresMS <= now || r.Revision == 0 {
			return Access{}, ErrDenied
		}
		a.Read = a.Read || r.Read
		a.Publish = a.Publish || r.Publish
		a.Runtime = a.Runtime || r.Runtime
		if r.ExpiresMS < a.ExpiresMS {
			a.ExpiresMS = r.ExpiresMS
		}
	}
	a.CurrentReference = objectHash(struct {
		Principal                Principal
		ProjectID, Owner, Origin string
		Revision                 uint64
		CatalogRevision          uint64
		Grants                   []grantRow
	}{p, id, owner, origin, revision, catalogRevision, rows})
	return a, nil
}

func (c *Catalog) CurrentProject(ctx context.Context, request *http.Request, projectID string) (Access, error) {
	if ctx == nil || request == nil || !text(projectID) {
		return Access{}, ErrDenied
	}
	p, e := c.source.CurrentExistingPrincipal(ctx, request)
	if e != nil {
		return Access{}, ErrDenied
	}
	tx, e := c.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if e != nil {
		return Access{}, e
	}
	defer tx.Rollback()
	var catalogRevision uint64
	if e = tx.QueryRowContext(ctx, "SELECT revision FROM developer_catalog_current WHERE singleton=1 FOR SHARE").Scan(&catalogRevision); e != nil || catalogRevision == 0 {
		return Access{}, ErrDenied
	}
	var owner, origin string
	var revision uint64
	var revoked bool
	if e = tx.QueryRowContext(ctx, "SELECT owner_account,runtime_origin,revision,revoked FROM developer_projects WHERE id=$1", projectID).Scan(&owner, &origin, &revision, &revoked); e != nil || revoked {
		return Access{}, ErrDenied
	}
	now := c.now().UnixMilli()
	rows, e := tx.QueryContext(ctx, `SELECT 'direct',account,revision,0,can_read,can_publish,can_runtime,expires_ms FROM developer_project_members WHERE project_id=$1 AND account=$2 AND revoked=false AND expires_ms>$3
 UNION ALL SELECT 'team',g.team_id,g.revision,m.revision,g.can_read,g.can_publish,g.can_runtime,LEAST(g.expires_ms,m.expires_ms) FROM developer_project_teams g JOIN developer_teams t ON t.id=g.team_id JOIN developer_team_members m ON m.team_id=g.team_id WHERE g.project_id=$1 AND m.account=$2 AND g.revoked=false AND t.revoked=false AND m.revoked=false AND g.expires_ms>$3 AND m.expires_ms>$3 ORDER BY 1,2`, projectID, p.Account, now)
	if e != nil {
		return Access{}, e
	}
	var grants []grantRow
	for rows.Next() {
		var r grantRow
		if e = rows.Scan(&r.Kind, &r.ID, &r.Revision, &r.MembershipRevision, &r.Read, &r.Publish, &r.Runtime, &r.ExpiresMS); e != nil {
			rows.Close()
			return Access{}, e
		}
		grants = append(grants, r)
	}
	e = errors.Join(rows.Err(), rows.Close())
	if e != nil {
		return Access{}, e
	}
	if e = c.source.AssertPrincipalCurrent(ctx, p); e != nil {
		return Access{}, ErrDenied
	}
	if e = c.source.AssertCatalogAuthorityCurrent(ctx, p); e != nil {
		return Access{}, ErrDenied
	}
	a, e := projectAccess(p, projectID, owner, origin, revision, catalogRevision, grants, c.now().UnixMilli())
	if e != nil {
		return Access{}, e
	}
	if e = tx.Commit(); e != nil {
		return Access{}, e
	}
	if a.ExpiresMS <= c.now().UnixMilli() || (!a.Read && !a.Publish && !a.Runtime) {
		return Access{}, ErrDenied
	}
	return a, nil
}

func (c *Catalog) CurrentPublisher(ctx context.Context, request *http.Request, projectID, publisherID string) (Publisher, error) {
	access, e := c.CurrentProject(ctx, request, projectID)
	if e != nil || !access.Publish || !text(publisherID) {
		return Publisher{}, ErrDenied
	}
	var p Publisher
	p.ProjectID, p.PublisherID = projectID, publisherID
	e = c.db.QueryRowContext(ctx, "SELECT account,key_role,public_original,public_sha256,registration_ref,revision,expires_ms,revoked FROM developer_publishers WHERE project_id=$1 AND publisher_id=$2", projectID, publisherID).Scan(&p.Account, &p.KeyRole, &p.PublicOriginal, &p.PublicSHA256, &p.RegistrationRef, &p.Revision, &p.ExpiresMS, &p.Revoked)
	if e != nil || p.Account != access.Principal.Account || p.Revoked || p.Revision == 0 || p.KeyRole != "ide-artifact-publisher" || !text(p.RegistrationRef) || len(p.PublicOriginal) == 0 || len(p.PublicOriginal) > 65536 || p.ExpiresMS <= c.now().UnixMilli() || hash(p.PublicOriginal) != p.PublicSHA256 {
		return Publisher{}, ErrDenied
	}
	probe := p
	probe.PublicOriginal = append([]byte(nil), p.PublicOriginal...)
	if e = c.source.AssertPublisherCurrent(ctx, access.Principal, probe); e != nil {
		return Publisher{}, ErrDenied
	}
	// Fresh ACL read after native registry current: revoked team/member/project
	// or changed original identity cannot survive through callback latency.
	last, e := c.CurrentProject(ctx, request, projectID)
	if e != nil || !last.Publish || last.CurrentReference != access.CurrentReference || p.ExpiresMS <= c.now().UnixMilli() {
		return Publisher{}, ErrDenied
	}
	p.PublicOriginal = append([]byte(nil), p.PublicOriginal...)
	return p, nil
}

func (c *Catalog) RecheckProject(ctx context.Context, r *http.Request, original Access) error {
	current, e := c.CurrentProject(ctx, r, original.ProjectID)
	if e != nil || current.CurrentReference != original.CurrentReference {
		return ErrDenied
	}
	return nil
}
func (c *Catalog) AuthorizeProjectRuntime(ctx context.Context, r *http.Request, projectID, registeredOrigin string) (Access, error) {
	a, e := c.CurrentProject(ctx, r, projectID)
	if e != nil || !a.Runtime || !canonicalOrigin(registeredOrigin) || a.RuntimeOrigin != registeredOrigin {
		return Access{}, ErrDenied
	}
	return a, nil
}

// System-level registration check ONLY. A registered origin is not permission
// to visit a project; AuthorizeProjectRuntime still checks every real request.
func (c *Catalog) AssertProjectRuntimeOrigin(ctx context.Context, origin string) error {
	if ctx == nil || !canonicalOrigin(origin) {
		return ErrDenied
	}
	if e := c.source.AssertSourceCurrent(ctx); e != nil {
		return ErrDenied
	}
	var id string
	var revision uint64
	var revoked bool
	e := c.db.QueryRowContext(ctx, "SELECT id,revision,revoked FROM developer_projects WHERE runtime_origin=$1", origin).Scan(&id, &revision, &revoked)
	if e != nil || !text(id) || revision == 0 || revoked {
		return ErrDenied
	}
	if e = c.source.AssertSourceCurrent(ctx); e != nil {
		return ErrDenied
	}
	return nil
}
func (c *Catalog) Principal(ctx context.Context, r *http.Request) (Principal, error) {
	if ctx == nil || r == nil {
		return Principal{}, ErrDenied
	}
	p, e := c.source.CurrentExistingPrincipal(ctx, r)
	if e != nil || !principalValid(p, c.now().UnixMilli()) {
		return Principal{}, ErrDenied
	}
	return p, nil
}
func (c *Catalog) AssertCurrent(ctx context.Context) error {
	if ctx == nil {
		return ErrDenied
	}
	if e := c.source.AssertSourceCurrent(ctx); e != nil {
		return ErrDenied
	}
	var revision uint64
	if e := c.db.QueryRowContext(ctx, "SELECT revision FROM developer_catalog_current WHERE singleton=1").Scan(&revision); e != nil || revision == 0 {
		return ErrDenied
	}
	return c.source.AssertSourceCurrent(ctx)
}

// Read-only reconciliation after commit errors or a late current failure.
// Missing never means "not executed" and never calls ApplyControl again.
func (c *Catalog) ObserveControl(ctx context.Context, r *http.Request, requestID, bindingSHA256 string) (*ControlResult, error) {
	if ctx == nil || r == nil || !text(requestID) || len(bindingSHA256) != 64 {
		return nil, ErrDenied
	}
	p, e := c.source.CurrentExistingPrincipal(ctx, r)
	if e != nil || !principalValid(p, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	var result ControlResult
	var state string
	e = c.db.QueryRowContext(ctx, "SELECT request_id,account,action,object_id,binding_sha256,revision,state FROM developer_control_operations WHERE account=$1 AND request_id=$2", p.Account, requestID).Scan(&result.RequestID, &result.Account, &result.Action, &result.ObjectID, &result.BindingSHA256, &result.Revision, &state)
	if e == sql.ErrNoRows {
		return nil, ErrUnknown
	}
	if e != nil {
		return nil, e
	}
	if result.BindingSHA256 != bindingSHA256 || state != "committed" || result.Revision == 0 {
		return nil, ErrConflict
	}
	if e = c.source.AssertPrincipalCurrent(ctx, p); e != nil || !principalValid(p, c.now().UnixMilli()) {
		return nil, ErrDenied
	}
	result.Committed = true
	return &result, nil
}
