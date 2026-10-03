package com.ynxweb4.music;

import java.io.*;
import java.util.*;

// Original minSdk 28: use bounded streaming and older collection primitives.
final class MusicIO {
    interface Guard { void check() throws Exception; }
    static long copy(InputStream in,OutputStream out,long limit,Guard guard)throws Exception {
        if(in==null)throw new IOException("Selected audio is unavailable");
        byte[] buffer=new byte[32768];long total=0;
        for(int n;(n=in.read(buffer))!=-1;){if(n==0)continue;total+=n;if(total>limit)throw new IOException("Original file exceeds limit");if(guard!=null)guard.check();out.write(buffer,0,n);}
        if(guard!=null)guard.check();return total;
    }
    static byte[] bounded(InputStream in,int limit)throws Exception {ByteArrayOutputStream out=new ByteArrayOutputStream();copy(in,out,limit,null);return out.toByteArray();}
    static byte[] prefix(InputStream in,int length)throws IOException {byte[] out=new byte[length];int at=0;while(at<length){int n=in.read(out,at,length-at);if(n<0)break;if(n>0)at+=n;}return Arrays.copyOf(out,at);}
    @SafeVarargs static <T> List<T> list(T... values){ArrayList<T> result=new ArrayList<>();for(T value:values)result.add(Objects.requireNonNull(value));return Collections.unmodifiableList(result);}
    @SafeVarargs static <T> Set<T> set(T... values){Set<T> result=new HashSet<>();for(T value:values)if(!result.add(Objects.requireNonNull(value)))throw new IllegalArgumentException("Duplicate value");return Collections.unmodifiableSet(result);}
}
