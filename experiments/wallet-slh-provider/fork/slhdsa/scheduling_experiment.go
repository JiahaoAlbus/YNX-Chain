// Experimental scheduling of original CIRCL v1.6.5 operations. Not a replacement
// algorithm or default backend. This module is reachable only by guarded modfile.
package slhdsa

import (
	"io"
	"runtime"
	"sync/atomic"
)

// Process-wide inner-worker pool. Tokens are never waited for: another active
// signing request takes priority over adding inner parallelism to one request.
var experimentPool = struct {
	tokens   chan struct{}
	requests atomic.Int64
	workers  atomic.Int64
	peak     atomic.Int64
	parallel atomic.Uint64
	serial   atomic.Uint64
}{tokens: make(chan struct{}, min(4, max(0, runtime.GOMAXPROCS(0)-1)))}

type SchedulingStats struct {
	Capacity, Requests, Workers, PeakWorkers int
	Parallel, Serial                         uint64
}

func ExperimentSchedulingStats() SchedulingStats {
	p := &experimentPool
	return SchedulingStats{cap(p.tokens), int(p.requests.Load()), int(p.workers.Load()), int(p.peak.Load()), p.parallel.Load(), p.serial.Load()}
}

type experimentPanic struct {
	raised bool
	value  any
}

func experimentInvoke(f func()) (p experimentPanic) {
	p.raised = true
	defer func() {
		if p.raised {
			p.value = recover()
		}
	}()
	f()
	p.raised = false
	return
}

type experimentJob struct {
	work func(*statePriv)
	done chan experimentPanic
}
type experimentWorker struct {
	jobs   chan experimentJob
	joined chan struct{}
}

func acquireExperimentWorker(sk *PrivateKey) *experimentWorker {
	p := &experimentPool
	if p.requests.Load() != 1 {
		p.serial.Add(1)
		return nil
	}
	select {
	case p.tokens <- struct{}{}:
	default:
		p.serial.Add(1)
		return nil
	}
	// Recheck after acquiring: independent requests that arrived in the meantime
	// win. Never nest a blocking token acquisition under the original key mutex.
	if p.requests.Load() != 1 {
		<-p.tokens
		p.serial.Add(1)
		return nil
	}
	n := p.workers.Add(1)
	for old := p.peak.Load(); n > old; old = p.peak.Load() {
		if p.peak.CompareAndSwap(old, n) {
			break
		}
	}
	p.parallel.Add(1)
	w := &experimentWorker{make(chan experimentJob), make(chan struct{})}
	go func() {
		defer close(w.joined)
		defer func() { p.workers.Add(-1); <-p.tokens }()
		s := sk.ID.params().NewStatePriv(sk.seed, sk.publicKey.seed)
		defer s.Clear()
		for job := range w.jobs {
			job.done <- experimentInvoke(func() { job.work(&s) })
		}
	}()
	return w
}
func (w *experimentWorker) close() {
	if w != nil {
		close(w.jobs)
		<-w.joined
	}
}
func (w *experimentWorker) pair(worker func(*statePriv), caller func()) {
	done := make(chan experimentPanic, 1)
	w.jobs <- experimentJob{worker, done}
	onCaller := experimentInvoke(caller)
	onWorker := <-done // Both branches join even when either raised a panic.
	if onCaller.raised {
		panic(onCaller.value)
	}
	if onWorker.raised {
		panic(onWorker.value)
	}
}

// SignRandomizedScheduled preserves upstream readRandom/msgPrime/PRFMsg/R and
// every original arithmetic function. Only SHA2_256f is admitted for this lab.
func SignRandomizedScheduled(priv *PrivateKey, random io.Reader, message *Message, context []byte) ([]byte, error) {
	if priv.ID != SHA2_256f {
		return nil, ErrSigParse
	}
	p := priv.ID.params()
	addRand, err := readRandom(random, p.n)
	if err != nil {
		return nil, err
	}
	msgPrime, err := message.getMsgPrime(context)
	if err != nil {
		return nil, err
	}
	experimentPool.requests.Add(1)
	defer experimentPool.requests.Add(-1)
	worker := acquireExperimentWorker(priv)
	defer worker.close()
	if worker == nil {
		return slhSignInternal(priv, msgPrime, addRand)
	}
	return slhSignScheduled(priv, msgPrime, addRand, worker)
}

// Original slhSignInternal layout and R selection, with only the two scheduled
// call sites below. Private state and signature storage remain in this process.
func slhSignScheduled(sk *PrivateKey, message, addRand []byte, w *experimentWorker) (out []byte, err error) {
	p := sk.ID.params()
	sigBytes := make([]byte, p.SignatureSize())
	complete := false
	defer func() {
		if !complete {
			clear(sigBytes)
		}
	}()
	var sig signature
	curSig := cursor(sigBytes)
	if !sig.fromBytes(p, &curSig) {
		return nil, ErrSigParse
	}
	p.PRFMsg(sig.rnd, sk.prfKey, addRand, message)
	digest := make([]byte, p.m)
	p.HashMsg(digest, sig.rnd, message, &sk.publicKey)
	md, idxTree, idxLeaf := p.parseMsg(digest)
	addr := p.NewAddress()
	defer addr.Clear()
	addr.SetTreeAddress(idxTree)
	addr.SetTypeAndClear(addressForsTree)
	addr.SetKeyPairAddress(idxLeaf)
	s := p.NewStatePriv(sk.seed, sk.publicKey.seed)
	defer s.Clear()
	s.forsSignScheduled(sig.forsSig, md, addr, w)
	pkFors := s.forsPkFromSig(sig.forsSig, md, addr)
	s.htSignScheduled(sig.htSig, pkFors, idxTree, idxLeaf, w)
	complete = true
	return sigBytes, nil
}

func (s *statePriv) forsSignScheduled(sig forsSignature, digest []byte, addr address, w *experimentWorker) {
	// The original public digest parser, once in index order. No R/leaf selection.
	indices := make([]uint32, s.k)
	in, bits, total := 0, uint32(0), uint32(0)
	maskA := (uint32(1) << s.a) - 1
	for i := range s.k {
		for bits < s.a {
			total = (total << 8) + uint32(digest[in])
			in++
			bits += 8
		}
		bits -= s.a
		indices[i] = (total >> bits) & maskA
	}
	workerAddr := s.NewAddress()
	workerAddr.Set(addr)
	defer workerAddr.Clear()
	do := func(ws *statePriv, a address, start uint32) {
		stack := ws.NewStack(ws.a - 1)
		defer stack.Clear()
		for i := start; i < ws.k; i += 2 {
			idx := indices[i]
			copy(sig[i].sk, ws.forsSkGen(a, (i<<ws.a)+idx))
			for j := range ws.a {
				shift := (idx >> j) ^ 1
				ws.forsNodeIter(stack, sig[i].auth[j], (i<<(ws.a-j))+shift, j, a)
			}
		}
	}
	w.pair(func(ws *statePriv) { do(ws, workerAddr, 1) }, func() { do(s, addr, 0) })
}

func (s *statePriv) xmssSignScheduled(stack stackNode, sig xmssSignature, msg []byte, idx uint32, addr address, w *experimentWorker) {
	// The largest authentication subtree owns 8 of the 15 non-selected leaves.
	// The caller owns paths 0..2 plus WOTS signing; no future message is signed.
	j := s.hPrime - 1
	workerAddr := s.NewAddress()
	workerAddr.Set(addr)
	defer workerAddr.Clear()
	w.pair(func(ws *statePriv) {
		workerStack := ws.NewStack(ws.hPrime - 1)
		defer workerStack.Clear()
		ws.xmssNodeIter(workerStack, sig.authPath[j*s.n:(j+1)*s.n], (idx>>j)^1, j, workerAddr)
	}, func() {
		authPath := cursor(sig.authPath)
		for k := uint32(0); k < j; k++ {
			s.xmssNodeIter(stack, authPath.Next(s.n), (idx>>k)^1, k, addr)
		}
		addr.SetTypeAndClear(addressWotsHash)
		addr.SetKeyPairAddress(idx)
		s.wotsSign(sig.wotsSig, msg, addr)
	})
}
func (s *statePriv) htSignScheduled(sig hyperTreeSignature, msg []byte, idxTree [3]uint32, idxLeaf uint32, w *experimentWorker) {
	addr := s.NewAddress()
	defer addr.Clear()
	addr.SetTreeAddress(idxTree)
	stack := s.NewStack(s.hPrime - 1)
	defer stack.Clear()
	s.xmssSignScheduled(stack, sig[0], msg, idxLeaf, addr, w)
	root := make([]byte, s.xmssPkSize())
	copy(root, msg)
	// Each next layer still consumes the previous signature's reconstructed root.
	for j := uint32(1); j < s.d; j++ {
		s.xmssPkFromSig(root, root, sig[j-1], idxLeaf, addr)
		idxLeaf = nextIndex(&idxTree, s.hPrime)
		addr.SetLayerAddress(j)
		addr.SetTreeAddress(idxTree)
		s.xmssSignScheduled(stack, sig[j], root, idxLeaf, addr, w)
	}
}

// ClearExperimentKey retires only in-process synthetic lab material after every
// original caller and worker has joined. This is not a physical erasure claim.
func ClearExperimentKey(key *PrivateKey) {
	clear(key.seed)
	clear(key.prfKey)
	clear(key.publicKey.seed)
	clear(key.publicKey.root)
	*key = PrivateKey{}
}
