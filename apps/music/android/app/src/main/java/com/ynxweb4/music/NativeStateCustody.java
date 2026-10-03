package com.ynxweb4.music;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Only encrypted Native SDK metadata. The original sessionBinding preference,
// Music account/content store and original device signer remain in their places.
final class NativeStateCustody implements NativeProductState.Persistence {
 private static final String ALIAS="ynx_music_session_aes_v1";
 private static final int LIMIT=524288;
 private final Context context;
 private final AtomicFile file;
 NativeStateCustody(Context context){this.context=context.getApplicationContext();file=new AtomicFile(new File(this.context.getFilesDir(),"native_product_runtime_music_v2.enc"));}
 private boolean anyRecord(){File base=file.getBaseFile();return base.exists()||new File(base.getPath()+".bak").exists()||new File(base.getPath()+".new").exists();}
 synchronized boolean hasRecord(){return anyRecord();}
 public synchronized String read()throws Exception{ synchronized(SecureStore.class){return readProtected();} }
 private String readProtected()throws Exception{
  // A failed legacy recovery is a hold, never an invitation to create a new store.
  SecureStore.get(context);
  if(!anyRecord())return "";
  byte[] raw;
  try(InputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] part=new byte[8192];int n,total=0;while((n=in.read(part))!=-1){total+=n;if(total>LIMIT*2)throw new IOException("Native encrypted record exceeds limit");out.write(part,0,n);}raw=out.toByteArray();
  }
  String encoded=new String(raw,StandardCharsets.US_ASCII);String[] pieces=encoded.split("\\.",-1);
  if(pieces.length!=2)throw new IOException("Original Native encrypted record is unavailable");
  byte[] iv=Base64.getDecoder().decode(pieces[0]),ciphertext=Base64.getDecoder().decode(pieces[1]);
  if(iv.length!=12||ciphertext.length<16||ciphertext.length>LIMIT+16||!Base64.getEncoder().encodeToString(iv).equals(pieces[0])||!Base64.getEncoder().encodeToString(ciphertext).equals(pieces[1]))throw new IOException("Original Native encrypted record is invalid");
  SecretKey key=existing();if(key==null)throw new IOException("Original Music protected storage key is missing");
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));
  byte[] bytes=cipher.doFinal(ciphertext);
  String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
  if(text.isEmpty())throw new IOException("Original Native protected metadata is empty");return text;
 }
 public synchronized void write(String value)throws Exception{ synchronized(SecureStore.class){writeProtected(value);} }
 private void writeProtected(String value)throws Exception{
  byte[] raw=value.getBytes(StandardCharsets.UTF_8);if(raw.length==0||raw.length>LIMIT)throw new IOException("Bounded Native metadata required");
  boolean inherited=anyRecord();if(inherited)read();else SecureStore.get(context);
  SecretKey key=existing();if(key==null){if(inherited||SecureStore.hasSavedRecord(context))throw new IOException("Preserve original Music custody; key missing");KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());key=generator.generateKey();}
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
  byte[] encrypted=cipher.doFinal(raw);if(cipher.getIV().length!=12)throw new IOException("Original GCM nonce format required");String encoded=Base64.getEncoder().encodeToString(cipher.getIV())+"."+Base64.getEncoder().encodeToString(encrypted);
  FileOutputStream output=null;try{output=file.startWrite();output.write(encoded.getBytes(StandardCharsets.US_ASCII));file.finishWrite(output);output=null;}catch(Exception failure){if(output!=null)file.failWrite(output);throw failure;}
  if(!value.equals(read()))throw new IOException("Native protected write is unconfirmed");
 }
 private SecretKey existing()throws Exception{KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);if(!keys.containsAlias(ALIAS))return null;SecretKey key=(SecretKey)keys.getKey(ALIAS,null);if(key==null)throw new IOException("Existing Music AES key is unavailable");return key;}
}
