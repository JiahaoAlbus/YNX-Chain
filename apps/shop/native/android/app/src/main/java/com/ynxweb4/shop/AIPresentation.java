package com.ynxweb4.shop;

// Presentation cancellation never claims that a dispatched provider request was
// cancelled. ApiClient continues recording its true network outcome.
final class AIPresentation {
    private long generation;
    synchronized long begin(){return ++generation;}
    synchronized boolean current(long attempt){return generation==attempt;}
    synchronized void cancel(long attempt){if(current(attempt))generation++;}
    synchronized void clear(){generation++;}
}
