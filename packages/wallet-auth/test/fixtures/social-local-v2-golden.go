// PUBLIC DATA golden only, no keys or Source qualification.
package main
import("encoding/json";"encoding/base64";"fmt";"strings")
type sourceScope struct {
	Source                   string `json:"source"`
	Store                    string `json:"store"`
	Schema                   string `json:"schema"`
	Inode                    string `json:"inode"`
	Restore                  string `json:"restore"`
	SourceGeneration         uint64 `json:"sourceGeneration"`
	NativeRestoreIncarnation uint64 `json:"nativeRestoreIncarnation"`
}
type sourcePair struct {
	Classic string `json:"classic"`
	PQ      string `json:"pq"`
}
type sourceCredential struct {
	Issuance        *sourceIssuancePolicy              `json:"issuance,omitempty"`
	Version         int                                `json:"version"`
	Bootstrap       string                             `json:"bootstrap"`
	Authority       string                             `json:"authority"`
	Role            string                             `json:"role"`
	Custodian       string                             `json:"custodian"`
	Epoch           uint64                             `json:"epoch"`
	Scope           sourceScope                        `json:"scope"`
	Public          sourcePair                         `json:"public"`
	HistoryEndpoint string                             `json:"historyEndpoint"`
	FirstEnrollment *sourceFirstEnrollmentPolicy       `json:"firstEnrollment,omitempty"`
	FirstPrepared   *sourceFirstPreparedIssuancePolicy `json:"firstPrepared,omitempty"`
}
type sourceIssuancePolicy struct {
	Version           uint64 `json:"version"`
	Purpose           string `json:"purpose"`
	Role              string `json:"role"`
	Realm             string `json:"realm"`
	Deployment        string `json:"deployment"`
	Instance          string `json:"instance"`
	HeaderSHA256      string `json:"headerSHA256"`
	KeyAlias          string `json:"keyAlias"`
	StorageGeneration uint64 `json:"storageGeneration"`
	NotBeforeMS       int64  `json:"notBeforeMS"`
	ExpiresMS         int64  `json:"expiresMS"`
}
type sourceFirstEnrollmentPolicy struct {
	ReplayAdmission string `json:"replayAdmission,omitempty"`
	// Optional only for source-only credentials. Directory opening requires ALL.
	DirectorySchema string `json:"directorySchema,omitempty"`
	Deployment      string `json:"deployment,omitempty"`
	Instance        string `json:"instance,omitempty"`
	HeaderSHA256    string `json:"headerSHA256,omitempty"`
	Route           string `json:"route,omitempty"`
	Finalization    string `json:"finalization,omitempty"`

	Version         uint64 `json:"version"`
	Realm           string `json:"realm"`
	AccountIssuer   string `json:"accountIssuer"`
	WriterAuthority string `json:"writerAuthority"`
	Mode            string `json:"mode"`
}
type sourceFirstPreparedIssuancePolicy struct {
	Version uint64 `json:"version"`
	Purpose string `json:"purpose"`
	Role string `json:"role"`
	Realm string `json:"realm"`
	Deployment string `json:"deployment"`
	Instance string `json:"instance"`
	HeaderSHA256 string `json:"headerSHA256"`
	DirectorySchema string `json:"directorySchema"`
	LifecycleSchema string `json:"lifecycleSchema"`
	HistoryAdmission string `json:"historyAdmission"`
	Finalization string `json:"finalization"`
	AccountIssuer string `json:"accountIssuer"`
	ClientID string `json:"clientId"`
	WriterAuthority string `json:"writerAuthority"`
	KeyAlias string `json:"keyAlias"`
	StorageGeneration uint64 `json:"storageGeneration"`
	NotBeforeMS int64 `json:"notBeforeMS"`
	ExpiresMS int64 `json:"expiresMS"`
}
type checkpointV2 struct {
Version uint32 `json:"version"`
Purpose string `json:"purpose"`
PlatformProfile uint32 `json:"platformProfile"`
EngineCommitDigest string `json:"engineCommitDigest"`
AdministrationDomain string `json:"administrationDomain"`
EnrollmentDigest string `json:"enrollmentDigest"`
PolicyOriginalDigest string `json:"policyOriginalDigest"`
IssuerCurrentDigest string `json:"issuerCurrentDigest"`
AnchorCurrentDigest string `json:"anchorCurrentDigest"`
NamespaceDigest string `json:"namespaceDigest"`
Operation string `json:"operation"`
IntentDigest string `json:"intentDigest"`
StorageGeneration string `json:"storageGeneration"`
KeyEpoch string `json:"keyEpoch"`
RegistrationRevision string `json:"registrationRevision"`
LocalOrdinal string `json:"localOrdinal"`
LocalTranscript string `json:"localTranscript"`
LocalRowDigest string `json:"localRowDigest"`
LocalResultDigest string `json:"localResultDigest"`
ProtectedOutputDigest string `json:"protectedOutputDigest"`
Sequence string `json:"sequence"`
PreviousDigest *string `json:"previousDigest"`
IssuedMS int64 `json:"issuedMS"`
ExpiresMS int64 `json:"expiresMS"`
}
type terminalV2 struct {
Version uint32 `json:"version"`
Purpose string `json:"purpose"`
PlatformProfile uint32 `json:"platformProfile"`
EngineCommitDigest string `json:"engineCommitDigest"`
CheckpointDigest string `json:"checkpointDigest"`
IssuerEnrollmentDigest string `json:"issuerEnrollmentDigest"`
AnchorEnrollmentDigest string `json:"anchorEnrollmentDigest"`
IssuerCurrentDigest string `json:"issuerCurrentDigest"`
AnchorCurrentDigest string `json:"anchorCurrentDigest"`
Operation string `json:"operation"`
Nonce string `json:"nonce"`
OnceDigest string `json:"onceDigest"`
ProtectedOutputDigest string `json:"protectedOutputDigest"`
Sequence string `json:"sequence"`
PreviousDigest *string `json:"previousDigest"`
State string `json:"state"`
IssuedMS int64 `json:"issuedMS"`
ExpiresMS int64 `json:"expiresMS"`
}
type rootOptInV1 struct {
Version uint32 `json:"version"`
Purpose string `json:"purpose"`
Bootstrap string `json:"bootstrap"`
Scope sourceScope `json:"scope"`
PlatformProfile uint32 `json:"platform_profile"`
CheckpointBodyVersion uint32 `json:"checkpoint_body_version"`
TerminalBodyVersion uint32 `json:"terminal_body_version"`
ReleaseOptInDigest [32]byte `json:"release_opt_in_digest"`
NotBeforeMS int64 `json:"not_before_ms"`
ExpiresMS int64 `json:"expires_ms"`
}

func b64(v any)string{b,e:=json.Marshal(v);if e!=nil{panic(e)};return base64.RawURLEncoding.EncodeToString(b)}
func main(){
p:=sourceFirstPreparedIssuancePolicy{Version:2,Purpose:"SOURCE_FIRST_PREPARED_DUAL_V1",Role:"first-prepared-issuer",Realm:"PUBLIC-realm",Deployment:"PUBLIC-deployment",Instance:"PUBLIC-instance",HeaderSHA256:strings.Repeat("1",64),DirectorySchema:"YNX-SOCIAL-FIRST-DIRECTORY-V4",LifecycleSchema:"YNX-SOCIAL-GENESIS-LIFECYCLE-V2",HistoryAdmission:"EXACT_ACCOUNT_NAMESPACE_COMPLETE_PREFIX_V1",Finalization:"SAME_ORIGINAL_OWNER_THROUGH_EFFECT_V1",AccountIssuer:"https://wallet-auth.ynxweb4.com",ClientID:"PUBLIC-client",WriterAuthority:"PUBLIC-writer",KeyAlias:"PUBLIC-issuer",StorageGeneration:9007199254740991,NotBeforeMS:1,ExpiresMS:1000}
s:=sourceScope{Source:"PUBLIC-source",Store:"PUBLIC-store",Schema:"PUBLIC-schema",Inode:"PUBLIC-inode",Restore:"PUBLIC-restore",SourceGeneration:9007199254740993,NativeRestoreIncarnation:18446744073709551615}
classic:=make([]byte,33);classic[0]=5;for i:=1;i<len(classic);i++{classic[i]=1};pq:=make([]byte,2592);for i:=range pq{pq[i]=1}
c:=sourceCredential{Version:1,Bootstrap:"PUBLIC-bootstrap",Authority:"PUBLIC-writer",Role:"issuer",Custodian:"PUBLIC-issuer",Epoch:18446744073709551615,Scope:s,Public:sourcePair{base64.RawURLEncoding.EncodeToString(classic),base64.RawURLEncoding.EncodeToString(pq)},HistoryEndpoint:"",FirstPrepared:&p}
cp:=checkpointV2{Version:2,Purpose:"SOCIAL_FIRST_DEVICE_INDEPENDENT_CHECKPOINT_V2",PlatformProfile:1,EngineCommitDigest:strings.Repeat("a",64),AdministrationDomain:"PUBLIC-domain",EnrollmentDigest:strings.Repeat("a",64),PolicyOriginalDigest:strings.Repeat("a",64),IssuerCurrentDigest:strings.Repeat("a",64),AnchorCurrentDigest:strings.Repeat("a",64),NamespaceDigest:strings.Repeat("a",64),Operation:"PUBLIC-operation",IntentDigest:strings.Repeat("a",64),StorageGeneration:"18446744073709551615",KeyEpoch:"9007199254740993",RegistrationRevision:"18446744073709551615",LocalOrdinal:"9007199254740993",LocalTranscript:strings.Repeat("a",64),LocalRowDigest:strings.Repeat("b",64),LocalResultDigest:strings.Repeat("a",64),ProtectedOutputDigest:strings.Repeat("a",64),Sequence:"1",PreviousDigest:nil,IssuedMS:1,ExpiresMS:1000}
nonce:=make([]byte,32);for i:=range nonce{nonce[i]=3}
t:=terminalV2{Version:2,Purpose:"SOCIAL_FIRST_DEVICE_INDEPENDENT_TERMINAL_V2",PlatformProfile:1,EngineCommitDigest:strings.Repeat("a",64),CheckpointDigest:strings.Repeat("a",64),IssuerEnrollmentDigest:strings.Repeat("b",64),AnchorEnrollmentDigest:strings.Repeat("a",64),IssuerCurrentDigest:strings.Repeat("a",64),AnchorCurrentDigest:strings.Repeat("a",64),Operation:"PUBLIC-operation",Nonce:base64.RawURLEncoding.EncodeToString(nonce),OnceDigest:strings.Repeat("b",64),ProtectedOutputDigest:strings.Repeat("a",64),Sequence:"1",PreviousDigest:nil,State:"local-committed",IssuedMS:1,ExpiresMS:1000}
var dig [32]byte;for i:=range dig{dig[i]=10};r:=rootOptInV1{1,"SOCIAL_FIRST_DEVICE_ORDINARY_LOCAL_SIGNED_V2","PUBLIC<&\u2028-bootstrap",s,1,2,2,dig,0,10000}
out:=map[string]string{"firstPreparedOriginal":b64(p),"credentialOriginal":b64(c),"checkpointOriginal":b64(cp),"terminalOriginal":b64(t),"rootOptInOriginal":b64(r)};b,e:=json.Marshal(out);if e!=nil{panic(e)};fmt.Println(string(b))}
