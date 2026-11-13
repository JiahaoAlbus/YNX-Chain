package com.ynxweb4.wallet.deviceapproval;

parcelable DeviceApprovalResultV1 {
    const int NOT_FOUND = 0;
    const int PENDING = 1;
    const int DENIED = 2;
    const int APPROVED = 3;
    const int UNKNOWN = 4;

    int status = 4;
    // Exact 32-byte DEVICE, PAIR and V4 request digest. A miss echoes only the query tuple.
    @nullable byte[] deviceOperation;
    @nullable byte[] pairOperation;
    @nullable byte[] requestDigest;
    // Present only for a committed, current APPROVED result.
    @nullable byte[] approvalOriginal;
    @nullable byte[] policyOriginal;
    @nullable byte[] requestOriginal;
}
