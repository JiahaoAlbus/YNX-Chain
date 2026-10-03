package com.ynxweb4.music;

// Session authority belongs to the original SDK. This boundary only retires
// older reads of the same verified account before UI/cache publication.
final class MusicReadBoundary {
    enum State { UNREAD, LOADING, READY, FAILED }
    private long generation;
    private State state=State.UNREAD;
    synchronized long begin(){state=State.LOADING;return ++generation;}
    synchronized void retire(){generation++;state=State.UNREAD;}
    synchronized boolean current(long expected){return generation==expected;}
    interface Publication {void publish()throws Exception;}
    synchronized boolean commit(long expected,Publication publication)throws Exception {
        if(!current(expected))return false;
        publication.publish();state=State.READY;return true;
    }
    synchronized boolean failed(long expected){if(!current(expected))return false;state=State.FAILED;return true;}
    synchronized State state(){return state;}
}
