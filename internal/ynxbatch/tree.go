package ynxbatch

import (
	"crypto/sha3"
	"crypto/sha512"
	"encoding"
	"encoding/binary"
	"hash"
)

type branchHasher struct {
	newHash              func() hash.Hash
	context              []byte
	n                    uint32
	branch               string
	optimized            bool
	leafState, nodeState []byte
}
type dualHasher struct{ a, b *branchHasher }

func writeFields(h hash.Hash, fields ...[]byte) {
	var size [4]byte
	for _, f := range fields {
		binary.BigEndian.PutUint32(size[:], uint32(len(f)))
		_, _ = h.Write(size[:])
		_, _ = h.Write(f)
	}
}
func newBranchHasher(c []byte, n uint32, branch string, optimized bool) (*branchHasher, error) {
	b := &branchHasher{context: clone(c), n: n, branch: branch, optimized: optimized}
	if branch == "A" {
		b.newHash = func() hash.Hash { return sha3.New512() }
	} else {
		b.newHash = sha512.New
	}
	if optimized {
		for _, p := range []struct {
			count uint32
			tag   string
			state *[]byte
		}{{5, "LEAF", &b.leafState}, {7, "NODE", &b.nodeState}} {
			h := b.newHash()
			_, _ = h.Write(u32(p.count))
			writeFields(h, []byte(Version+"/"+p.tag+"/"+branch), c, u32(n))
			var err error
			*p.state, err = h.(encoding.BinaryMarshaler).MarshalBinary()
			if err != nil {
				return nil, err
			}
		}
	}
	return b, nil
}
func newDualHasher(c Context, n uint32, optimized bool) (*dualHasher, error) {
	if !validN(n) {
		return nil, invalid("N")
	}
	wire, err := EncodeContext(c)
	if err != nil {
		return nil, err
	}
	a, err := newBranchHasher(wire, n, "A", optimized)
	if err != nil {
		return nil, err
	}
	b, err := newBranchHasher(wire, n, "B", optimized)
	if err != nil {
		return nil, err
	}
	return &dualHasher{a: a, b: b}, nil
}
func (b *branchHasher) digest(leaf bool, suffix ...[]byte) (out [64]byte, err error) {
	h := b.newHash()
	if b.optimized {
		state := b.nodeState
		if leaf {
			state = b.leafState
		}
		if err = h.(encoding.BinaryUnmarshaler).UnmarshalBinary(state); err != nil {
			return out, err
		}
	} else {
		tag, count := "NODE", uint32(7)
		if leaf {
			tag, count = "LEAF", 5
		}
		_, _ = h.Write(u32(count))
		writeFields(h, []byte(Version+"/"+tag+"/"+b.branch), b.context, u32(b.n))
	}
	writeFields(h, suffix...)
	copy(out[:], h.Sum(nil))
	return out, nil
}
func (b *branchHasher) leaf(index uint32, message []byte) ([64]byte, error) {
	return b.digest(true, u32(index), message)
}
func (b *branchHasher) node(level, index uint32, left, right [64]byte) ([64]byte, error) {
	return b.digest(false, u32(level), u32(index), left[:], right[:])
}

type tree [][][64]byte

func buildTree(b *branchHasher, messages [][]byte) (tree, error) {
	levels := tree{make([][64]byte, len(messages))}
	for i, m := range messages {
		v, err := b.leaf(uint32(i), m)
		if err != nil {
			return nil, err
		}
		levels[0][i] = v
	}
	for level := 1; len(levels[level-1]) > 1; level++ {
		children := levels[level-1]
		parents := make([][64]byte, len(children)/2)
		for j := range parents {
			v, err := b.node(uint32(level), uint32(j), children[2*j], children[2*j+1])
			if err != nil {
				return nil, err
			}
			parents[j] = v
		}
		levels = append(levels, parents)
	}
	return levels, nil
}
func (t tree) root() []byte { v := t[len(t)-1][0]; return clone(v[:]) }
func (t tree) path(index uint32) [][]byte {
	p := make([][]byte, len(t)-1)
	for l := range p {
		v := t[l][index^1]
		p[l] = clone(v[:])
		index >>= 1
	}
	return p
}
func pathRoot(b *branchHasher, index uint32, message []byte, path [][]byte) ([64]byte, error) {
	v, err := b.leaf(index, message)
	if err != nil {
		return v, err
	}
	for l, s := range path {
		var sibling [64]byte
		copy(sibling[:], s)
		up := index >> 1
		if index&1 == 0 {
			v, err = b.node(uint32(l+1), up, v, sibling)
		} else {
			v, err = b.node(uint32(l+1), up, sibling, v)
		}
		if err != nil {
			return v, err
		}
		index = up
	}
	return v, nil
}
