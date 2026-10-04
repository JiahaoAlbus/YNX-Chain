# Windows local workbench lifecycle source

The normal WPF entry remains the inherited hosted workspace client. These new
components are not wired into `MainWindow`, and no new Windows installer or
local workbench activation is claimed.

`WindowsJobProcess.Start` is a lifecycle primitive for a trusted caller. It checks
the executable's installed location, but does not call `LocalWorkbenchPayload.Inspect`,
verify the Node version/core tree or supply a filesystem/network sandbox. A future
entry must establish isolation/project binding and inspect its payload before
enabling Start. The separate inspector requires the exact Windows x64 pin, archive digest,
explicit `localWorkspace` opt-in and bundled Windows Node 26 input. Node metadata
is a producer-owned `Resources/runtime/node-runtime.json` with schemaVersion 1,
architecture `win32-x64`, exact `nodeVersion` (e.g. `v26.7.0`) matching the composed
distribution's requiredNodeVersion, and lowercase SHA-256 `sha256` of `node.exe`.
Missing/changed metadata, Darwin artifacts, foreign executable locations,
reparse-point ancestry and an incompatible PE machine fail before process start.
Inspection does not verify an extracted runtime tree or authenticate any account.

The lifecycle component locks only its OS-user profile with `FileShare.None`,
creates an unnamed Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, creates its own
Node child suspended with non-inherited handles, assigns the child, then resumes.
It never opens a process by PID or attaches existing processes to the Job.
Startup failures close the handles/lock and terminate only the newly created
child. Backend exit closes its own Job to terminate detached terminal/helper
children and releases process/profile handles before its Exit task resolves.
`DisposeAsync` closes that Job
and awaits the owned backend exit without blocking the UI thread. The Job's
kernel lifetime also covers abrupt termination of its owning app process.

The next real entry must verify the extracted runtime tree against its producer
pin, create a real project/profile binding, build a whitelisted local environment,
start this component off the UI thread, await actual backend readiness and route
WebView2 to that listener. Native close must resolve dirty editors, store/flush
UI state, then stop the owned component. That work must also port Unix-specific
local path/private-directory checks and Cocoa-only storage/close detection to the
Windows host. The Job is a lifecycle boundary, not an AppContainer/network policy,
and it provides no Wallet, Chain, AI or canonical identity authority.

Known retained inputs include Theia node-pty 1.2.0-beta.12 Windows x64/arm64 ConPTY
prebuilds. They have not been loaded by an actual Windows Node 26 process. The
owned checkout has no bundled Windows Node, no Windows sealed Theia artifact and
no retained fixed WebView2 runtime; its drivelist binary is Darwin arm64. These
missing inputs are not downloaded or replaced with a hosted page by this source.

Validation on macOS: Node source-contract checks and inherited Windows structural
checks only. C# compilation, P/Invoke struct layouts, Job failure/descendant/handle
behavior, ConPTY, WebView2 and installed Windows GUI remain NOT_VERIFIED until a
real Windows build and execution. No .NET/Windows runtime was installed here.
