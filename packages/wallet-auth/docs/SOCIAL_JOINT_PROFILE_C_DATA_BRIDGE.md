# Sole Go Social fresh joint-profile DATA C bridge

This bridge calls the unchanged PR429 module PrepareBodyDATA / InspectBodyOriginalDATA. It contains no second JSON body/frame encoder, signer, verifier, nonce/clock provider or Root entry. uint64 scope/epochs and int64 clocks are copied without JS numeric conversion. The C caller owns stable valid mapped/aligned memory for the entire synchronous call; invalid raw addresses are not a sandboxed public input. No pointer is retained. All original spans are cloned before calling the sole Go body implementation. Text must be UTF8. Four captures are individually bounded to 65536, not a combined cap. Auth outer envelope remains <=65536 and is not constructed here.

Both exports return owned canonical body bytes and 64 ASCII lowercase SHA256 hex characters through caller buffers. No NUL terminator is appended. On every non-OK all three outputs are unchanged. Output regions cannot overlap each other or any input struct/view. Null policies are NOT_SUPPLIED. Caller must not share/mutate spans concurrently.

## Normal sole-archive integration

The Go bridge is package main WITHOUT a main function. The original LINK/Auth/A aggregate producer must add this exact bridge.go as one source fragment to its existing sole archive main package, add the exact local C header include path, and resolve github.com/JiahaoAlbus/YNX-Chain/sdk/socialfreshjointprofile to this same pinned original module using its fixed build-only replace/source recipe. Retain its existing sole main, runtime and archive. Alternatively the aggregate owner may supply a reviewed same-namespace source adapter; the SDK does not claim this is already adopted. Do not build another c-archive. Existing Core20/Go50 archives are unchanged and do not acquire these symbols from source delivery.

Production source list is exactly body.go, go.mod, cabi/bridge.go, cabi/social_fresh_joint_profile_data.h. normal-inputs.json and the zero-argument collector pin them. PUBLIC callers/golden/Cgo test adapters are guarded by social_joint_data_test and excluded from production archive/member proposal. New CI compiles/runs only ./cabi tests, not old root body tests. It generates a host DATA test executable, never a production archive or mobile/Native grant.

The sourceSigningInput frame writer remains the actual P02/Auth kernel function. SOURCE_FRAME_DEPENDENCY.json requests a same-namespace forwarding adapter. No frame function is implemented or declared as available here; neither standalone header syntax nor the test binary proves a production linked Source or archive.
