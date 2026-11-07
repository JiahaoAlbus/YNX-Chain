"""Validate optional original held-public-input metadata, never authority.

Footprints are retained raw bytes, not disk I/O, wire bytes, current-file
validation or a transaction denominator. Keep each owner's latest snapshot.
"""
import copy

SCOPE = 'YNX-PQ-LAB-HELD-PUBLIC-INPUTS/v1'
FIELDS = {'scope', 'state', 'staticOriginalFiles', 'staticOriginalBytes',
          'activationOriginalFiles', 'activationOriginalBytes', 'cacheRetained',
          'cacheAdmissionReason', 'cacheMaxBytes', 'cacheMaxFiles', 'snapshotOnly'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def inspect(value, cache=None):
    require(type(value) is dict and set(value) == FIELDS, 'closed original source-input footprint required')
    require(value['scope'] == SCOPE and value['snapshotOnly'] is True,
            'source-input footprint is diagnostic only')
    require(type(value['cacheMaxBytes']) is int and value['cacheMaxBytes'] == 32 << 20
            and type(value['cacheMaxFiles']) is int and value['cacheMaxFiles'] == 16,
            'original optional cache budget changed')
    for field, limit in [('staticOriginalFiles',16),('activationOriginalFiles',16),
                         ('staticOriginalBytes',16 << 30),('activationOriginalBytes',16 << 30)]:
        require(type(value[field]) is int and 0 <= value[field] <= limit,
                'bounded original footprint count required: ' + field)
    n, size = value['staticOriginalFiles'], value['staticOriginalBytes']
    an, activation = value['activationOriginalFiles'], value['activationOriginalBytes']
    require(n + an <= 16 and (n == 0) == (size == 0) and (an == 0) == (activation == 0),
            'original file and byte counts disagree')
    require(type(value['cacheRetained']) is bool, 'original cache-retention observation required')
    state = value['state']
    require(state in ('NOT_LOADED','CACHE_ENTRY','INVOCATION_HELD','CLOSED'), 'original source-input state differs')
    if state in ('NOT_LOADED','CLOSED'):
        require(n == an == 0 and value['cacheRetained'] is False
                and value['cacheAdmissionReason'] == 'NOT_EVALUATED', 'unloaded/closed originals cannot be retained')
    else:
        require(n > 0, 'loaded original public files missing')
        retained = state == 'CACHE_ENTRY'
        reason = 'WITHIN_BOUNDS' if retained else 'BYTE_BOUND' if size > 32 << 20 else 'NOT_RETAINED_WITHIN_BOUNDS'
        require(value['cacheRetained'] is retained and value['cacheAdmissionReason'] == reason
                and (not retained or size <= 32 << 20), 'original footprint/cache admission differs')
    if cache is not None:
        require(cache['scope'] == 'YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1', 'original cache snapshot scope differs')
        expected = (1, n, size) if value['cacheRetained'] else (0, 0, 0)
        require(all(type(cache[k]) is int for k in ('entries','heldFiles','originalBytes'))
                and tuple(cache[k] for k in ('entries','heldFiles','originalBytes')) == expected,
                'held input footprint differs from original cache snapshot')
    return copy.deepcopy(value)
