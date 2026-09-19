# DEX paused checkpoint — Weekly v3

Weekly v3 supersedes unfinished DEX expansion. Existing work is preserved, not deployed.

Parent: 75b84d4cb103c5731ce65e56afdb5af21b630da0. This final bounded change retains the interrupted write-time review fence and adds eight deterministic tests: account/chain/disconnect/provider/review invalidation and snapshot/deadline expiry during a delayed store read, plus valid commit and pre-schedule rejection. Test providers are fixtures only.

Unfinished: durable terminal archival and the next-trade lifecycle; independent public runtime binding, installed Wallet approval and real chain actions. Signed pending records must not be discarded to simulate completion. All public/installed/approval/transaction completion claims for this source remain false.

Do not continue this backlog while the Finance Broker Sandbox weekly scope is active. No Exchange or Quant changes are included. Existing Exchange untracked transport tests remain preserved in their own worktree.
