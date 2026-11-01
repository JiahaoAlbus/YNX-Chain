// Test-only extraction of b831 original Go consumer declarations; no Go SDK codec.
package main
import("bytes";"crypto/sha256";"encoding/base64";"encoding/hex";"encoding/json";"errors";"fmt";"io";"os";"strconv";"strings")
var errToolInvalid=errors.New("invalid")
type TaskPageSnapshot struct{}
type TaskPageReference struct {
	SelectionID string `json:"selectionId"`
	Version     string `json:"version"` // Original Browser SHA-512, not a Grant.
}
type taskRunRequest struct {
	SelectedPages    []TaskPageReference `json:"selectedPages,omitempty"`
	preparedPages    []TaskPageSnapshot
	RunID            string   `json:"runId"`
	TaskRevision     uint64   `json:"taskRevision"`
	Generation       uint64   `json:"generation"`
	Prompt           string   `json:"prompt"`
	Resume           bool     `json:"resume"`
	AuthorizationRef string   `json:"authorizationRef"`
	ToolIDs          []string `json:"toolIds,omitempty"`
}
func validateTaskPageReferences(refs []TaskPageReference) error {
	if len(refs) > 16 {
		return errToolInvalid
	}
	seen := map[string]bool{}
	for _, r := range refs {
		h, err := hex.DecodeString(r.Version)
		if r.SelectionID == "" || len(r.SelectionID) > 128 || len(h) != 64 || err != nil || strings.ToLower(r.Version) != r.Version || seen[r.SelectionID] {
			return errToolInvalid
		}
		seen[r.SelectionID] = true
	}
	return nil
}
func main(){
 raw,e:=io.ReadAll(io.LimitReader(os.Stdin,1<<20));if e!=nil{panic(e)}
 var input struct{BodyOriginal string `json:"bodyOriginal"`};if e=json.Unmarshal(raw,&input);e!=nil{panic(e)}
 body,e:=base64.RawURLEncoding.DecodeString(input.BodyOriginal);if e!=nil||len(body)>32<<10{panic("body cap")}
 var r taskRunRequest;d:=json.NewDecoder(bytes.NewReader(body));d.DisallowUnknownFields();if e=d.Decode(&r);e!=nil{panic(e)};if e=d.Decode(&struct{}{});e!=io.EOF{panic("trailing")};if e=validateTaskPageReferences(r.SelectedPages);e!=nil{panic(e)}
 h:=sha256.Sum256(body)
 out:=struct{RunID string `json:"runId"`;TaskRevision string `json:"taskRevision"`;Generation string `json:"generation"`;SelectedPages []TaskPageReference `json:"selectedPages"`;BodyDigest string `json:"bodyDigest"`}{r.RunID,strconv.FormatUint(r.TaskRevision,10),strconv.FormatUint(r.Generation,10),r.SelectedPages,hex.EncodeToString(h[:])}
 b,e:=json.Marshal(out);if e!=nil{panic(e)};fmt.Println(string(b))
}
