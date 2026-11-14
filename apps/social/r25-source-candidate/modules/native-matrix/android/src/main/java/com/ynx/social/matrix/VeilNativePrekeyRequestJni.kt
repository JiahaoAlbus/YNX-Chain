package com.ynx.social.matrix

/** Same accepted Source only. Native captures originals, creates the exact
 * proof and builds the authorize HTTP body. No Java-supplied Root/key/frame. */
internal object VeilNativePrekeyRequestJni {
    /** [exact authorize JSON, original device frame, original nonce32].
     * Owner/current fences are mandatory before AND after foreign consumers. */
    @JvmStatic external fun prepareAuthorize(source: Long, effectBody: ByteArray,
        effectTransport: ByteArray, budgetMs: Long): Array<ByteArray>
    /** QUERY ONLY for the original effect. Never signing or HTTP permission. */
    @JvmStatic external fun retained(source: Long, effectBody: ByteArray,
        effectTransport: ByteArray): ByteArray
    /** Fixed read purpose only; raw D1/L1/Q2 DATA never becomes write authority. */
    @JvmStatic external fun prepareRead(source:Long,body:ByteArray,transport:ByteArray,budgetMs:Long):ByteArray
    @JvmStatic external fun produceRead(source:Long,originalNonce:ByteArray):ByteArray
    @JvmStatic external fun currentRead(source:Long,frame:ByteArray,originalNonce:ByteArray):Int
    @JvmStatic external fun retainedRead(source:Long,originalNonce:ByteArray):ByteArray
    private fun readBuffer(raw:ByteArray,magic:String,minimum:Int):java.nio.ByteBuffer {
        require(raw.size in minimum..1048576 && raw.copyOfRange(0,8).contentEquals((magic+"\u0000").toByteArray(Charsets.UTF_8)))
        return java.nio.ByteBuffer.wrap(raw).also{it.position(8)}
    }
    internal fun readPreparedData(raw:ByteArray):Pair<ByteArray,ByteArray>{
        val b=readBuffer(raw,"YNXPKD1",45);val n=b.int;require(n in 1..16384&&n==b.remaining()-32)
        val frame=ByteArray(n).also{b.get(it)};val nonce=ByteArray(32).also{b.get(it)};return frame to nonce
    }
    internal fun readProducedData(raw:ByteArray,frame:ByteArray,nonce:ByteArray):ByteArray{
        require(nonce.size==32);val b=readBuffer(raw,"YNXPKL1",50);val n=b.int;require(n in 1..16384&&n<=b.remaining()-36)
        val same=ByteArray(n).also{b.get(it)};require(same.contentEquals(frame));val p=b.int;require(p in 1..655360&&p==b.remaining()-32)
        val proof=ByteArray(p).also{b.get(it)};val original=ByteArray(32).also{b.get(it)};require(original.contentEquals(nonce));return proof
    }
    internal fun readRetainedData(raw:ByteArray,nonce:ByteArray):Int{
        require(nonce.size==32);val b=readBuffer(raw,"YNXPKQ2",48);val state=b.int;require(state in 1..3)
        val original=ByteArray(32).also{b.get(it)};require(original.contentEquals(nonce));val n=b.int;require(n>=0&&n==b.remaining())
        if(state!=3){val packet=ByteArray(n).also{b.get(it)};val prepared=readPreparedFrameFromProducedData(packet);readProducedData(packet,prepared,nonce)}
        return state
    }
    private fun readPreparedFrameFromProducedData(raw:ByteArray):ByteArray{
        val b=readBuffer(raw,"YNXPKL1",50);val n=b.int;require(n in 1..16384&&n<=b.remaining()-36);return ByteArray(n).also{b.get(it)}
    }

    /** Original authorize capture DATA, not current write permission. */
    internal fun retainedAuthorizeData(raw:ByteArray):Array<ByteArray>?{
        val b=readBuffer(raw,"YNXPKQ1",52);val state=b.int;val first=b.int;require(state in 1..3)
        require(state!=1||first==0);require(state!=2||first!=0)
        val nonce=ByteArray(32).also{b.get(it)};val n=b.int;require(n>=0&&n==b.remaining())
        if(state==3)return null
        val packet=ByteArray(n).also{b.get(it)};val p=readBuffer(packet,"YNXPKA1",50)
        val f=p.int;require(f in 1..16384&&f<=p.remaining()-36);val frame=ByteArray(f).also{p.get(it)}
        val j=p.int;require(j in 1..655360&&j==p.remaining()-32);val json=ByteArray(j).also{p.get(it)}
        val same=ByteArray(32).also{p.get(it)};require(same.contentEquals(nonce));return arrayOf(json,frame,nonce)
    }

}
