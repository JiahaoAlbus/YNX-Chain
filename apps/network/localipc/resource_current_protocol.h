#ifndef YNX_NETWORK_RESOURCE_CURRENT_PROTOCOL_H
#define YNX_NETWORK_RESOURCE_CURRENT_PROTOCOL_H
/* Original localipc Request/Response, HTTP/1.1 POST over one owned Unix fd.
 * This header is DATA documentation for original LINK/Auth native composition,
 * not a Root installer, registration API, NAPI capture, signer or permission.
 * Expected UID/PID/start/image/triple are native-only trusted inputs; never
 * construct them from endpoint JSON, argv, node status or these observations.
 */
#define YNX_NETWORK_CURRENT_IPC_VERSION "YNX-NETWORK-LOCAL-IPC/v1"
#define YNX_NETWORK_CURRENT_HTTP_PATH "/v1/call"
#define YNX_NETWORK_CURRENT_HTTP_HOST "localipc"
#define YNX_NETWORK_CURRENT_HTTP_TYPE "application/json"
#define YNX_NETWORK_CURRENT_REQUEST "resource_current"
#define YNX_NETWORK_CURRENT_RETIRE "resource_current_retire"
#define YNX_NETWORK_CURRENT_JOIN "resource_current_join"
#define YNX_NETWORK_CURRENT_CLOSE "resource_current_close"
#define YNX_NETWORK_CURRENT_MESSAGE_MAX 16384
#define YNX_NETWORK_CURRENT_PAYLOAD_MAX 12288
#define YNX_NETWORK_CURRENT_DATA_FIELDS 9
#define YNX_NETWORK_CURRENT_TTL_MS 20000
/* Each request is exactly original {version,id,operation,payload:{}}.
 * id is original ASCII [A-Za-z0-9_-]{1,80}; it supplies correlation only.
 * No init/open/rebind/PID/path/triple/counter/allow/issuer field on the wire.
 * First resource_current{} borrows one concrete reader only in a fixed host
 * ResourceCurrentConfig with selected original resource and OS-bound caller.
 * Every later Current/Retire/Join/Close uses the SAME fd/session/reader.
 * No reconnect/retry, even after partial response/timeout/disconnect.
 *
 * Original Response.result.payload retains code/classification/authority/
 * registeredIssuer/productionEnabled/resourceCurrent(exact original9), adding:
 * observation:{sessionId,server:{pid,uid,startIdentity,imagePath,imageSHA256},
 * caller:{same5},lifetime:{partialAcquired,retired,joined,physicalComplete}}.
 * server/caller values are observations, independently kernel/OS checked by
 * the consumer; they do not prove a Root, registered issuer or Go identity by
 * their mere JSON presence. Darwin startIdentity is darwin:<sec>:<usec> from
 * proc_pidinfo(PROC_PIDTBSDINFO); Linux is linux:<kernel-boot-id>:<startticks>.
 * Current DATA_ONLY contains original9. Retire RETIRED; Join DRAINED/PENDING;
 * Close CLOSED/PENDING. All three authority booleans always remain false.
 * Join PENDING retains exact acquisition/read debt. Only confirmed Close is
 * physicalComplete. Lost socket alone cannot prove remote reader completion.
 * Non-selected normal clients retain original3s idle; only an already bound
 * typed borrow can stay idle up to60s. Source expiry remains original20s.
 */
#endif
