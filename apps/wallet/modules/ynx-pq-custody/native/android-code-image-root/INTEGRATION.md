# Original Android JNI CODE-image expectation loan

This is the Android adapter of the existing Root/A protected external postbuild
CODE registration model. It does not create a Source, DEVICE, approval, signing
permission or new cryptographic Root. Network's three-main-executable profile
and `/proc/self/exe` check cannot qualify a JNI shared image.

The zero-input strong factory selects only compiled reviewed registration
locators for its actual process name. Normal rows are empty. A locator contains
no final image hash or size. The external record is created after final link;
the original A/Root owner must independently review, select, protect and place
it. DATA materialization does not perform that installation or admit a Root.
There is no runtime installer, environment override or caller JSON/path setter.

The private external CODE record has the exact keys `version`, `kind`, `service`,
`processName`, `applicationUID`, `applicationGID`, `image`, `buildRecord`,
`sourceCommit`, `sourceTree`. Version is 1, kind is
`YNX_ANDROID_AUTH_JNI_CODE_IMAGE_PROFILE/v1`, and service is
`YNX_AUTH_ANDROID_DEVICE_V4`. The process name must equal the reviewed locator
and the actual process. UID/GID must equal the actual application actor. Both
source IDs are exact lowercase Git40. `image` and `buildRecord` each have exact
`path`, `bytes`, `sha256`, `uid`, `gid`, `mode` keys. Paths are canonical absolute
regular single-link files, SHA is lowercase64, and bytes are positive. The
image cap is 256MiB, build record cap 16MiB and registration cap 64KiB.

Use the existing CanonicalDATA parser and SHA implementation. The Root
registration is Root-UID-owned, non-group/world-writable and held with its full
non-symlink parent chain. The selected image/build record are held and matched
to the independently registered pins before DATA is exposed. The loaded
adapter's own address must belong to that exact mapped JNI image; an observed
image is only a constraint and never supplies the expectation. Image hashing
is streamed once at acquisition; later current checks use SAME FD/named and
maps/inode/nanosecond identity. Root registration current remains independent.

Auth adopts the partial root and view first, reads the typed DATA and compares
its own fixed service/app/process constraints. It keeps the same root/view
until all capture/Source children and all seven original FD resources have
physically returned. Root retire blocks new work; cleanup can release views
without a fresh current authorization. Root close reports known child/IO debt
before physical close selection as `unknown=0/physical_done=0`; the same owner
may progress after those debts return. Once physical close is selected and
uncertain, `unknown=1/physical_done=0` retains that close, with no repeated
physical close. A remembered original failure (including code0) may accompany
physical_done=1; it does not erase the physical receipt. The final release
clears only an actually closed original root pointer.

Compile the strong adapter into the same normal JNI image as Auth R2. The
actual Main image is composed through its existing `ynx-native-operation`
Cargo/JNI target; the supplied CMake OBJECT target describes this adapter's
thin objects and does not replace that normal image build. The image contract
requires the normal installation's extracted, canonical regular `.so` file.
A compressed or direct-APK mapping does not satisfy this file contract.

Each independently held FD is selected for cleanup once even if a sibling
close becomes unknown. Retain that first paired failure and its original
platform code; subsequent cleanup must neither redispatch the uncertain close
nor replace its first cause with a later `errno` value.

Do not
link PUBLIC filesystem/producers into products. Real Root records, postbuild
APK/JNI, installation and Root selection are absent; source or PUBLIC controls
do not establish real Source/registration/signing or a new APK.
