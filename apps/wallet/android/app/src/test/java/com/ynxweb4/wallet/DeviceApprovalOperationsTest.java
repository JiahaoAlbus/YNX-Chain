package com.ynxweb4.wallet;

import com.ynxweb4.wallet.deviceapproval.DeviceApprovalResultV1;
import junit.framework.TestCase;

public final class DeviceApprovalOperationsTest extends TestCase {
    private static final class Holder implements DeviceApprovalOperations.Holder {
        DeviceApprovalResultV1 result;
        DeviceApprovalPeer.OriginalCaller originalCaller;
        int dispatches, queries;
        public DeviceApprovalResultV1 reserveReview(DeviceApprovalPeer.OriginalCaller caller, byte[] device, byte[] pair, byte[] digest,
                byte[] allocation, byte[] registration, byte[] request) {
            originalCaller=caller; dispatches++; device[0]=9; request[0]=9; return result;
        }
        public DeviceApprovalResultV1 readOriginal(DeviceApprovalPeer.OriginalCaller caller, byte[] device, byte[] pair, byte[] digest) {
            originalCaller=caller; queries++; device[0]=9; return result;
        }
    }
    // Only the controlled test constructs this token reflectively; normal code
    // can obtain one solely through peer.captureCaller() on the Binder thread.
    private DeviceApprovalPeer.OriginalCaller caller() throws Exception {
        DeviceApprovalPeer peer=new DeviceApprovalPeer(null,"test.app",new byte[32]);
        java.lang.reflect.Constructor<DeviceApprovalPeer.OriginalCaller> constructor =
            DeviceApprovalPeer.OriginalCaller.class.getDeclaredConstructor(DeviceApprovalPeer.class,int.class);
        constructor.setAccessible(true); return constructor.newInstance(peer,7);
    }
    private DeviceApprovalResultV1 result(int status) {
        DeviceApprovalResultV1 result = new DeviceApprovalResultV1();
        result.status=status; result.deviceOperation=new byte[32]; result.pairOperation=new byte[32];
        result.requestDigest=new byte[32];
        return result;
    }
    public void testDispatchCopiesOriginalsAndReturnedProjection() throws Exception {
        Holder holder = new Holder(); holder.result=result(DeviceApprovalResultV1.APPROVED);
        holder.result.approvalOriginal=new byte[]{3}; holder.result.policyOriginal=new byte[]{4};
        holder.result.requestOriginal=new byte[]{1};
        DeviceApprovalOperations operations = new DeviceApprovalOperations(holder);
        byte[] device=new byte[32], request=new byte[]{1};
        DeviceApprovalPeer.OriginalCaller caller=caller();
        DeviceApprovalResultV1 returned=operations.dispatch(caller,device,new byte[32],new byte[32],
            new byte[]{2},new byte[]{2},request);
        assertEquals(0,device[0]); assertEquals(1,request[0]);
        holder.result.deviceOperation[0]=8; holder.result.requestOriginal[0]=8;
        assertEquals(0,returned.deviceOperation[0]); assertEquals(1,returned.requestOriginal[0]);
        assertSame(caller,holder.originalCaller);
        assertEquals(1,holder.dispatches); assertEquals(0,holder.queries);
    }
    public void testCrossRequestAndOversizeFailWithoutRetry() throws Exception {
        Holder holder = new Holder(); holder.result=result(DeviceApprovalResultV1.APPROVED);
        holder.result.requestOriginal=new byte[]{2};
        DeviceApprovalOperations operations = new DeviceApprovalOperations(holder);
        try { operations.dispatch(caller(),new byte[32],new byte[32],new byte[32],new byte[]{1},new byte[]{1},new byte[]{1}); fail(); }
        catch (IllegalStateException expected) { }
        assertEquals(1,holder.dispatches); assertEquals(0,holder.queries);
        holder.result.policyOriginal=new byte[524289];
        try { operations.query(caller(),new byte[32],new byte[32],new byte[32]); fail(); }
        catch (IllegalStateException expected) { }
        assertEquals(1,holder.queries);
    }
    public void testQueryMissIsUnknownAndNeverDispatches() throws Exception {
        Holder holder = new Holder(); DeviceApprovalOperations operations = new DeviceApprovalOperations(holder);
        byte[] device=new byte[32];
        DeviceApprovalPeer.OriginalCaller caller=caller();
        DeviceApprovalResultV1 result=operations.query(caller,device,new byte[32],new byte[32]);
        assertEquals(DeviceApprovalResultV1.UNKNOWN,result.status);
        assertEquals(0,device[0]); assertNull(result.approvalOriginal);
        assertSame(caller,holder.originalCaller);
        assertEquals(1,holder.queries); assertEquals(0,holder.dispatches);
    }
    public void testMissingCallerCannotReachHolder() {
        Holder holder = new Holder(); DeviceApprovalOperations operations = new DeviceApprovalOperations(holder);
        try { operations.dispatch(null,new byte[32],new byte[32],new byte[32],new byte[]{1},new byte[]{1},new byte[]{1}); fail(); }
        catch (NullPointerException expected) { }
        try { operations.query(null,new byte[32],new byte[32],new byte[32]); fail(); }
        catch (NullPointerException expected) { }
        assertEquals(0,holder.dispatches); assertEquals(0,holder.queries);
    }
    public void testOversizeOriginalNeverReservesOrBorrows() throws Exception {
        Holder holder = new Holder(); DeviceApprovalOperations operations = new DeviceApprovalOperations(holder);
        for (int which = 0; which < 2; which++) {
            byte[] registration = new byte[which == 0 ? 16385 : 1];
            byte[] request = new byte[which == 1 ? 16385 : 1];
            try { operations.dispatch(caller(),new byte[32],new byte[32],new byte[32],new byte[]{1},registration,request); fail(); }
            catch (IllegalArgumentException expected) { }
        }
        assertEquals(0,holder.dispatches); assertEquals(0,holder.queries);
    }
}
