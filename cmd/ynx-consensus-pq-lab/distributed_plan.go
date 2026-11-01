//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type distributedPublicInput struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type distributedPublicOutput struct {
	Version               string                 `json:"version"`
	File                  distributedPublicInput `json:"file"`
	SyntheticOnly         bool                   `json:"syntheticOnly"`
	NodeStarted           bool                   `json:"nodeStarted"`
	PhysicalHostsVerified bool                   `json:"physicalHostsVerified"`
}

func distributedHash(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func distributedExecutingBinary(r consensus.PQLabDistributedRequest, index int) error {
	if index < 0 || index >= len(r.Hosts) {
		return errors.New("original local host index required")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil || executable != r.Hosts[index].LabBinary {
		return errors.New("current executable differs from independently pinned host lab binary")
	}
	_, err = distributedRead(executable, r.LabBinarySHA256, 128<<20)
	return err
}
func distributedExecutingLocal(root, pin string) error {
	raw, err := distributedRead(filepath.Join(root, "plan.json"), pin, consensus.MaxPQLabDistributedPlanBytes)
	if err != nil {
		return err
	}
	var p consensus.PQLabDistributedPlan
	if err := distributedJSON(raw, &p); err != nil {
		return err
	}
	for i, h := range p.Request.Hosts {
		if h.RootDir == root {
			return distributedExecutingBinary(p.Request, i)
		}
	}
	return errors.New("current root is not a pinned host")
}
func distributedRead(path, pin string, limit int64) ([]byte, error) {
	raw, err := readPQLabWorkloadFile(path, limit)
	if err != nil {
		return nil, err
	}
	if len(pin) != 64 || distributedHash(raw) != pin {
		return nil, errors.New("independent exact public input pin mismatch")
	}
	return raw, nil
}
func distributedJSON(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing public distributed JSON")
	}
	canonical, err := json.Marshal(out)
	if err != nil || !bytes.Equal(canonical, raw) {
		return errors.New("noncanonical public distributed JSON")
	}
	return nil
}
func distributedWrite(dir, name string, value any) (distributedPublicOutput, error) {
	var out distributedPublicOutput
	if err := preflightPQLabCreate(dir); err != nil {
		return out, err
	}
	if err := os.Mkdir(dir, 0700); err != nil {
		return out, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return out, err
	}
	path := filepath.Join(dir, name)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return out, err
	}
	n, e := f.Write(raw)
	if e == nil && n != len(raw) {
		e = io.ErrShortWrite
	}
	if err = errors.Join(e, f.Sync(), f.Close()); err != nil {
		return out, err
	}
	d, err := os.Open(dir)
	if err != nil {
		return out, err
	}
	if err = errors.Join(d.Sync(), d.Close()); err != nil {
		return out, err
	}
	out = distributedPublicOutput{Version: "YNX-PQ-DISTRIBUTED-PUBLIC-OUTPUT/v1", File: distributedPublicInput{Path: path, SHA256: distributedHash(raw)}, SyntheticOnly: true}
	return out, nil
}

// All subcommands are local, bounded, one-attempt producers/readers. This code
// contains no network transport, process runner, credential argv or fallback.
func runPQLabDistributed(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("choose request, identity, plan, import, registration, halt or activate")
	}
	op := args[0]
	fs := flag.NewFlagSet("distributed "+op, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	synthetic := fs.Bool("synthetic", false, "required: isolated host-local synthetic operation only")
	var request, requestPin, migration, migrationPin, template, templatePin, identities, identitiesPin, plan, planPin, root, output, schedule, schedulePin, appHash string
	index := -1
	var height int64
	switch op {
	case "request":
		fs.StringVar(&migration, "migration", "", "original unbound public migration")
		fs.StringVar(&migrationPin, "migration-sha256", "", "independent exact raw pin")
		fs.StringVar(&template, "template", "", "canonical explicit host/source request template")
		fs.StringVar(&templatePin, "template-sha256", "", "independent exact template pin")
		fs.StringVar(&output, "output", "", "fresh public output directory")
	case "identity":
		fs.StringVar(&request, "request", "", "original public request")
		fs.StringVar(&requestPin, "request-sha256", "", "independent request pin")
		fs.IntVar(&index, "node", -1, "local host index")
	case "plan":
		fs.StringVar(&migration, "migration", "", "original unbound public migration")
		fs.StringVar(&migrationPin, "migration-sha256", "", "independent exact raw pin")
		fs.StringVar(&request, "request", "", "original public request")
		fs.StringVar(&requestPin, "request-sha256", "", "independent request pin")
		fs.StringVar(&identities, "identities", "", "canonical four public identity path/hash entries")
		fs.StringVar(&identitiesPin, "identities-sha256", "", "independent identity-input manifest pin")
		fs.StringVar(&output, "output", "", "fresh public output directory")
	case "import":
		fs.StringVar(&plan, "plan", "", "original public plan")
		fs.StringVar(&planPin, "plan-sha256", "", "independent original plan pin")
		fs.IntVar(&index, "node", -1, "local host index")
	case "registration", "halt", "activate":
		fs.StringVar(&root, "root", "", "original host-local root")
		fs.StringVar(&planPin, "plan-sha256", "", "independent original plan pin")
		if op == "registration" {
			fs.Int64Var(&height, "checkpoint-height", 0, "actual common checkpoint height")
			fs.StringVar(&appHash, "checkpoint-app-hash", "", "independent exact expected committed state hash")
		}
		if op == "halt" {
			fs.Int64Var(&height, "height", 0, "explicit future normal halt height")
		}
		if op == "activate" {
			fs.StringVar(&schedule, "schedule", "", "independently approved common public schedule")
			fs.StringVar(&schedulePin, "schedule-hash", "", "normal canonical schedule hash")
		}
	default:
		return errors.New("unknown distributed operation")
	}
	if err := parsePQLabFlags(fs, args[1:]); err != nil {
		return err
	}
	if !*synthetic {
		return errors.New("explicit synthetic operation acknowledgement required")
	}
	var result any
	var err error
	switch op {
	case "request", "plan":
		raw, e := distributedRead(migration, migrationPin, 64<<20)
		if e != nil {
			return e
		}
		var m chain.ConsensusMigrationState
		if e = json.Unmarshal(raw, &m); e != nil {
			return e
		}
		canonical, e := m.CanonicalJSON()
		if e != nil || !bytes.Equal(raw, canonical) {
			return errors.New("complete canonical original migration required")
		}
		if op == "request" {
			raw, e = distributedRead(template, templatePin, consensus.MaxPQLabDistributedRequestBytes)
			if e != nil {
				return e
			}
			var r consensus.PQLabDistributedRequest
			if e = distributedJSON(raw, &r); e != nil {
				return e
			}
			r, e = consensus.NewPQLabDistributedRequest(m, r)
			if e != nil {
				return e
			}
			result, err = distributedWrite(output, "request.json", r)
		} else {
			raw, e = distributedRead(request, requestPin, consensus.MaxPQLabDistributedRequestBytes)
			if e != nil {
				return e
			}
			manifest, e := distributedRead(identities, identitiesPin, 32<<10)
			if e != nil {
				return e
			}
			var inputs []distributedPublicInput
			if e = distributedJSON(manifest, &inputs); e != nil {
				return e
			}
			if len(inputs) != 4 {
				return errors.New("exactly four independently pinned public identities required")
			}
			var identityRaw [][]byte
			var pins []string
			for _, input := range inputs {
				b, e := distributedRead(input.Path, input.SHA256, consensus.MaxPQLabDistributedIdentityBytes)
				if e != nil {
					return e
				}
				identityRaw = append(identityRaw, b)
				pins = append(pins, input.SHA256)
			}
			p, e := consensus.BuildPQLabDistributedPlan(m, raw, requestPin, identityRaw, pins)
			if e != nil {
				return e
			}
			result, err = distributedWrite(output, "plan.json", p)
		}
	case "identity":
		raw, e := distributedRead(request, requestPin, consensus.MaxPQLabDistributedRequestBytes)
		if e != nil {
			return e
		}
		r, e := consensus.DecodePQLabDistributedRequest(raw, requestPin)
		if e != nil {
			return e
		}
		if e = distributedExecutingBinary(r, index); e != nil {
			return e
		}
		result, err = consensus.GeneratePQLabDistributedIdentity(raw, requestPin, index)
	case "import":
		raw, e := distributedRead(plan, planPin, consensus.MaxPQLabDistributedPlanBytes)
		if e != nil {
			return e
		}
		p, _, _, e := consensus.DecodePQLabDistributedPlan(raw, planPin)
		if e != nil {
			return e
		}
		if e = distributedExecutingBinary(p.Request, index); e != nil {
			return e
		}
		result, err = consensus.ImportPQLabDistributedPlan(raw, planPin, index)
	case "registration":
		if err = distributedExecutingLocal(root, planPin); err != nil {
			return err
		}
		result, err = consensus.PreparePQLabDistributedRegistration(root, planPin, height, appHash)
	case "halt":
		if err = distributedExecutingLocal(root, planPin); err != nil {
			return err
		}
		result, err = consensus.PublishPQLabDistributedHeightHalt(root, planPin, height)
	case "activate":
		if err = distributedExecutingLocal(root, planPin); err != nil {
			return err
		}
		raw, e := readPQLabWorkloadFile(schedule, 32<<10)
		if e != nil {
			return e
		}
		result, err = consensus.ActivatePQLabDistributedLocal(root, planPin, raw, schedulePin)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
