package com.ynxweb4.video;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

final class NativeBoundaryCheck {
    static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    public static void main(String[] args)throws Exception{
        check(VideoRequestBoundary.url("/v1/videos?q=hello").toString().equals("https://video.ynxweb4.com/video/api/v1/videos?q=hello"),"official endpoint");
        for(String path:new String[]{"https://other.example/v1/videos","//other.example/v1/videos","/media/../secret","/v1/videos#fragment","/media/\\other"}){
            try{VideoRequestBoundary.url(path);throw new AssertionError("unsafe path accepted");}catch(IllegalArgumentException expected){}
        }
        check(VideoRequestBoundary.publicRead("/v1/videos?q=x","GET"),"public discover");
        check(VideoRequestBoundary.publicRead("/v1/videos/video_1/comments","GET"),"public comments");
        check(!VideoRequestBoundary.publicRead("/v1/history","GET")&&!VideoRequestBoundary.publicRead("/v1/videos/video_1/comments","POST"),"private requests need canonical native session");
        VideoRequestBoundary boundary=new VideoRequestBoundary();
        long old=boundary.advance();
        CountDownLatch started=new CountDownLatch(1),complete=new CountDownLatch(1);
        AtomicInteger writes=new AtomicInteger();
        Thread request=new Thread(()->{started.countDown();try{complete.await();boundary.require(old);writes.incrementAndGet();}catch(IllegalStateException expected){}catch(InterruptedException error){throw new RuntimeException(error);}});
        request.start();started.await();long next=boundary.advance();complete.countDown();request.join();
        check(writes.get()==0&&boundary.matches(next),"late request crossed navigation/account boundary");
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicInteger forwarded=new AtomicInteger();
        server.createContext("/redirect",exchange->{exchange.getResponseHeaders().set("Location","/target");exchange.sendResponseHeaders(302,-1);exchange.close();});
        server.createContext("/target",exchange->{forwarded.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});
        server.start();
        try{
            HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:"+server.getAddress().getPort()+"/redirect").openConnection();
            VideoRequestBoundary.configure(connection);
            check(connection.getResponseCode()==302&&forwarded.get()==0,"redirect escaped request boundary");
            connection.disconnect();
        }finally{server.stop(0);}
        System.out.println("PASS: Android Video official endpoint, guest routes, late-request isolation and real HTTP redirect rejection");
    }
}
