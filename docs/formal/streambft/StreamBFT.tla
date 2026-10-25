----------------------------- MODULE StreamBFT -----------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Validators, Blocks, MaxView, Byzantine

Quorum == Cardinality(Validators) - ((Cardinality(Validators) - 1) \div 3)

VARIABLES view, lastVote, lockedView, lockedBlock, votes, committed

vars == <<view, lastVote, lockedView, lockedBlock, votes, committed>>

TypeOK ==
  /\ view \in 0..MaxView
  /\ lastVote \in [Validators -> 0..MaxView]
  /\ lockedView \in [Validators -> 0..MaxView]
  /\ lockedBlock \in [Validators -> Blocks \cup {"none"}]
  /\ votes \subseteq (Validators \X (0..MaxView) \X Blocks)
  /\ committed \subseteq Blocks

Init ==
  /\ view = 0
  /\ lastVote = [v \in Validators |-> 0]
  /\ lockedView = [v \in Validators |-> 0]
  /\ lockedBlock = [v \in Validators |-> "none"]
  /\ votes = {}
  /\ committed = {}

Vote(v, b, parentView, parentBlock) ==
  /\ v \in Validators \ Byzantine
  /\ view > lastVote[v]
  /\ \/ parentView >= lockedView[v]
     \/ parentBlock = lockedBlock[v]
  /\ lastVote' = [lastVote EXCEPT ![v] = view]
  /\ lockedView' = [lockedView EXCEPT ![v] = IF parentView > @ THEN parentView ELSE @]
  /\ lockedBlock' = [lockedBlock EXCEPT ![v] = IF parentView > lockedView[v] THEN parentBlock ELSE @]
  /\ votes' = votes \cup {<<v, view, b>>}
  /\ UNCHANGED <<view, committed>>

ByzantineVote(v, b) ==
  /\ v \in Byzantine
  /\ votes' = votes \cup {<<v, view, b>>}
  /\ UNCHANGED <<view, lastVote, lockedView, lockedBlock, committed>>

AdvanceView ==
  /\ view < MaxView
  /\ view' = view + 1
  /\ UNCHANGED <<lastVote, lockedView, lockedBlock, votes, committed>>

Commit(b) ==
  /\ Cardinality({v \in Validators : <<v, view, b>> \in votes}) >= Quorum
  /\ committed' = committed \cup {b}
  /\ UNCHANGED <<view, lastVote, lockedView, lockedBlock, votes>>

Next ==
  \/ \E v \in Validators \ Byzantine, b \in Blocks, pv \in 0..view, pb \in Blocks : Vote(v, b, pv, pb)
  \/ \E v \in Byzantine, b \in Blocks : ByzantineVote(v, b)
  \/ AdvanceView
  \/ \E b \in Blocks : Commit(b)

HonestNoEquivocation ==
  \A v \in Validators \ Byzantine, w \in 0..MaxView :
    Cardinality({b \in Blocks : <<v, w, b>> \in votes}) <= 1

QuorumIntersection ==
  \A left, right \in SUBSET Validators :
    (Cardinality(left) >= Quorum /\ Cardinality(right) >= Quorum)
      => (left \cap right) \notin SUBSET Byzantine

Spec == Init /\ [][Next]_vars

=============================================================================
