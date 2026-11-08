"""Optional closed CLI diagnostics; no source admission or retry permission.

Absent frozen fields cannot reconstruct historical errors. firstCausePresent
reports a non-nil error at this CLI boundary, not an upstream root cause.
"""
ERROR_CLASSES = frozenset(('ORIGINAL_UNKNOWN', 'OWNER_BUSY', 'CONTEXT_CANCELED',
    'DEADLINE_EXCEEDED', 'NOT_FOUND', 'PERMISSION_DENIED', 'ALREADY_EXISTS',
    'PROOF_REJECTED', 'IO_FAILURE', 'OWNER_SCOPE_REJECTED', 'OWNER_RETIRED',
    'CHECKPOINT_REJECTED', 'SOURCE_CHANGED', 'NONCE_OR_BALANCE_REJECTED',
    'REQUEST_CONFLICT', 'PUBLIC_INPUT_REJECTED', 'OPERATION_REJECTED'))
PHASES = {'sign': ('SIGN',), 'recover': ('RECOVER',), 'close-owner': ('CLOSE_OWNER',),
          'confirm': ('CONFIRM_MATERIALS', 'CONFIRM')}


def readback(reply, operation):
    def require(condition, message):
        if not condition:
            raise RuntimeError(message)
    require(operation in PHASES, 'original diagnostic operation required')
    if 'failure' not in reply:
        return dict(status='NOT_EMITTED_BY_FROZEN_CLI' if reply.get('code') in ('UNKNOWN', 'REJECTED')
                    else 'NOT_APPLICABLE', diagnostic=None, upstreamFirstCauseReconstructed=False,
                    authorityGranted=False, retryAllowed=False)
    value = reply['failure']
    require(type(value) is dict and set(value) == {'version', 'errorClass', 'failurePhase', 'firstCausePresent'},
            'closed original failure fields required')
    require(value['version'] == 'YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1'
            and type(value['errorClass']) is str and value['errorClass'] in ERROR_CLASSES
            and type(value['failurePhase']) is str and value['failurePhase'] in PHASES[operation]
            and value['firstCausePresent'] is True, 'original safe failure vocabulary differs')
    require(reply.get('code') in ('UNKNOWN', 'REJECTED') and 'result' in reply and reply['result'] is None,
            'failure diagnostic cannot qualify a result or success')
    require((reply['code'] == 'UNKNOWN') == (value['errorClass'] == 'ORIGINAL_UNKNOWN'),
            'original UNKNOWN code and safe diagnostic disagree')
    return dict(status='SAFE_CLASSIFICATION_AT_CLI_BOUNDARY', diagnostic=dict(value),
                upstreamFirstCauseReconstructed=False, authorityGranted=False, retryAllowed=False)
