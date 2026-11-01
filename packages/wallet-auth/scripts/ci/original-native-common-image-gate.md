# Normal common-image gate

Run `node check.mjs exact-build-plan.json` against the **final** normal Native
image, never its object file or a PUBLIC producer. Plan version 1 supplies
`image` and exactly one `goArchives` entry, each with absolute `path`, `bytes`
and lowercase `sha256`. The caller's real linker input receipt must independently
bind this complete archive: the plan alone cannot establish linker provenance.

This gate invokes actual Darwin `otool` and `nm`: it requires a linked
BUNDLE/DYLIB/EXECUTE, strong definitions of the normal capture/context/startup
callees, no weak or unresolved owned `ynx_` symbols, and the actual strong startup
in the unique complete Go archive. It rechecks input identity after inspection.
No dynamic-lookup, weak implementation, second runtime or fixture library may be
used to make the normal build pass. Node's own N-API imports are not owned `ynx_`
symbols and remain the host's responsibility.

`node check.test.mjs` runs eight actual compiler/nm controls: strict-linked
positive, no archive, two archives, weak capture, missing callee, relocatable
object, changed bytes and symlink. Each run retains compiler sources and objects
under a unique local `evidence-*` directory. These PUBLIC gate fixtures do not
prove production build, registration, actor lifecycle, Root, Source, account
approval, signing or installation. A production PASS must still be followed by
actual Node registration checks and the owner's normal matching build.

Parent owns this directory only. Native source/registration/CAS and actual
common-image build remain the original Native owner's sole write set. Official
build/release remains original A's responsibility.
