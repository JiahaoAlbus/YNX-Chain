// Command gencatalog freezes only the reachable JSON type graph at immutable Git
// commits. It reads Git objects, never the dirty checkout, and runs no chain code.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

type field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Optional bool   `json:"optional,omitempty"`
}
type shape struct {
	Kind   string  `json:"kind"`
	Elem   string  `json:"elem,omitempty"`
	Fields []field `json:"fields,omitempty"`
}
type catalog struct {
	Commit   string           `json:"commit"`
	Version  int              `json:"version"`
	Root     string           `json:"root"`
	HashRoot string           `json:"hashRoot,omitempty"`
	Domain   string           `json:"domain"`
	Types    map[string]shape `json:"types"`
}
type decl struct {
	expr ast.Expr
	pkg  string
}

var repo string

func git(args ...string) string {
	b, e := exec.Command("git", append([]string{"-C", repo}, args...)...).Output()
	if e != nil {
		panic(e)
	}
	return string(b)
}
func main() {
	flag.StringVar(&repo, "repo", ".", "repository containing both immutable source commits")
	flag.Parse()
	const a = "089265843926a4890a04f7ba4468491510defc80"
	const c = "3a49306956eef0f5933714760f4cc34a7f93c584"
	const baseline = "be9f03833ac3a7579bd96f22f6bf49f3d8dccc7b"
	out := map[string]catalog{}
	for _, spec := range []struct {
		name, commit, root, hashRoot, domain string
		version                              int
	}{
		{"native-a-v1", a, "chain.devnetSnapshot", "", "YNX_CHAIN_DEVNET_SNAPSHOT_V2", 1},
		{"native-a-v2", a, "chain.devnetSnapshot", "", "YNX_CHAIN_DEVNET_SNAPSHOT_V2", 2},
		{"native-baseline-v2", baseline, "chain.devnetSnapshot", "", "YNX_CHAIN_DEVNET_SNAPSHOT_V2", 2},
		{"abci-a-v14", a, "consensus.CommittedState", "consensus.committedStateHashDocument", "YNX_ABCI_STATE_V14", 14},
		{"abci-c-v13", c, "consensus.CommittedState", "consensus.committedStateHashDocument", "YNX_ABCI_STATE_V13", 13},
	} {
		if strings.TrimSpace(git("rev-parse", spec.commit)) != spec.commit {
			panic("commit mismatch")
		}
		decls := map[string]decl{}
		paths := strings.Fields(git("ls-tree", "-r", "--name-only", spec.commit, "internal/chain", "internal/consensus", "internal/assetauth"))
		sort.Strings(paths)
		for _, p := range paths {
			if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
				continue
			}
			f, e := parser.ParseFile(token.NewFileSet(), p, git("show", spec.commit+":"+p), 0)
			if e != nil {
				panic(e)
			}
			for _, d := range f.Decls {
				g, ok := d.(*ast.GenDecl)
				if !ok {
					continue
				}
				for _, s := range g.Specs {
					t, ok := s.(*ast.TypeSpec)
					if ok {
						decls[f.Name.Name+"."+t.Name.Name] = decl{t.Type, f.Name.Name}
					}
				}
			}
		}
		types := map[string]shape{}
		var resolve func(string)
		var expr func(ast.Expr, string) string
		expr = func(e ast.Expr, pkg string) string {
			switch t := e.(type) {
			case *ast.Ident:
				switch t.Name {
				case "string", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float64", "float32":
					return t.Name
				case "byte":
					return "uint8"
				case "any":
					return "any"
				}
				n := pkg + "." + t.Name
				resolve(n)
				return n
			case *ast.SelectorExpr:
				n := t.X.(*ast.Ident).Name + "." + t.Sel.Name
				if n == "time.Duration" {
					return "int64"
				}
				if n != "time.Time" && n != "json.RawMessage" {
					resolve(n)
				}
				return n
			case *ast.StarExpr:
				n := "*" + expr(t.X, pkg)
				types[n] = shape{Kind: "pointer", Elem: expr(t.X, pkg)}
				return n
			case *ast.ArrayType:
				if t.Len != nil {
					panic("fixed array unsupported in catalog")
				}
				el := expr(t.Elt, pkg)
				n := "[]" + el
				types[n] = shape{Kind: "slice", Elem: el}
				return n
			case *ast.MapType:
				if x, ok := t.Key.(*ast.Ident); !ok || x.Name != "string" {
					panic("non-string map key")
				}
				el := expr(t.Value, pkg)
				n := "map[string]" + el
				types[n] = shape{Kind: "map", Elem: el}
				return n
			case *ast.InterfaceType:
				return "any"
			default:
				panic(fmt.Sprintf("unsupported expression %T", e))
			}
		}
		resolve = func(n string) {
			if _, ok := types[n]; ok {
				return
			}
			d, ok := decls[n]
			if !ok {
				panic("unresolved " + n)
			}
			types[n] = shape{Kind: "resolving"}
			st, ok := d.expr.(*ast.StructType)
			if !ok {
				types[n] = shape{Kind: "alias", Elem: expr(d.expr, d.pkg)}
				return
			}
			s := shape{Kind: "struct"}
			for _, f := range st.Fields.List {
				if len(f.Names) == 0 {
					embedded := expr(f.Type, d.pkg)
					s.Fields = append(s.Fields, types[embedded].Fields...)
					continue
				}
				if len(f.Names) != 1 {
					panic("multiple fields at " + n)
				}
				name := f.Names[0].Name
				if !ast.IsExported(name) {
					continue
				}
				tag := ""
				if f.Tag != nil {
					x, e := strconv.Unquote(f.Tag.Value)
					if e != nil {
						panic(e)
					}
					tag = reflect.StructTag(x).Get("json")
				}
				if tag == "-" {
					continue
				}
				parts := strings.Split(tag, ",")
				if parts[0] != "" {
					name = parts[0]
				}
				optional := false
				for _, v := range parts[1:] {
					if v == "omitempty" {
						optional = true
					} else {
						panic("unsupported JSON tag " + v)
					}
				}
				s.Fields = append(s.Fields, field{name, expr(f.Type, d.pkg), optional})
			}
			types[n] = s
		}
		resolve(spec.root)
		if spec.hashRoot != "" {
			resolve(spec.hashRoot)
		}
		out[spec.name] = catalog{spec.commit, spec.version, spec.root, spec.hashRoot, spec.domain, types}
	}
	b, e := json.MarshalIndent(out, "", "  ")
	if e != nil {
		panic(e)
	}
	os.Stdout.Write(append(b, '\n'))
}
