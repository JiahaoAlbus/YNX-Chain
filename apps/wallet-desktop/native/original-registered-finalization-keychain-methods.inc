private:
 static bool samePublicPair(const DevicePairPublicView&a,const DevicePairPublicView&b){return a.pa==b.pa&&a.pb==b.pb;}
 static bool sameCreation(const std::string&a,const std::string&b){auto decode=[](const std::string&s)->id{NSData*d=[[NSData alloc]initWithBase64EncodedString:ns(s) options:0];return d?[NSPropertyListSerialization propertyListWithData:d options:NSPropertyListImmutable format:nil error:nil]:nil;};id x=decode(a),y=decode(b);return[x isKindOfClass:NSArray.class]&&[y isKindOfClass:NSArray.class]&&[x count]==2&&[y count]==2&&[[x firstObject]isKindOfClass:NSDate.class]&&[[x firstObject]isEqual:[y firstObject]];}
 static void originalItem(const DeviceAssociationIdentity&old,const DeviceAssociationIdentity&now){
  if(!hex64(old.network)||!hex64(old.operation)||!old.metadata.empty()||old.network!=now.network||old.operation!=now.operation||old.persistentRef!=now.persistentRef||!samePublicPair(old.publicPair,now.publicPair)||!sameCreation(old.osIdentity,now.osIdentity))fail("DEVICE_FINALIZATION_ORIGINAL_ITEM_CHANGED");
  if(now.metadata.empty()){if(now.account!=old.account||now.osIdentity!=old.osIdentity)fail("DEVICE_FINALIZATION_PENDING_CHANGED");}
  else{const auto prefix="uid:"+std::to_string(getuid())+":network:"+old.network+":registration:";if(now.account.compare(0,prefix.size(),prefix)||!hex64(now.account.substr(prefix.size())))fail("DEVICE_FINALIZATION_REGISTERED_ACCOUNT");}
 }
 struct PrivateFrame{
  NSMutableData*__strong material=nil;std::array<std::pair<const uint8_t*,size_t>,4>parts{};
  PrivateFrame()=default;PrivateFrame(const PrivateFrame&)=delete;PrivateFrame&operator=(const PrivateFrame&)=delete;
  ~PrivateFrame(){@try{if(material.length)[material resetBytesInRange:NSMakeRange(0,material.length)];}@catch(id){}material=nil;}
 };
 DeviceAssociationIdentity readPrivateOriginal(const DeviceAssociationIdentity&old,const RegisteredDeviceAssociation&r,OriginalRegisteredDeviceFinalizationAuthority&source,PrivateFrame&frame){
  actor();source.assertCurrent();source.assertRegisteredCurrent(r,old.publicPair);if(r.result||r.registrationOriginal.empty()||r.registrationOriginal.size()>16384||r.associationOriginal.empty()||r.associationOriginal.size()>65536)fail("DEVICE_FINALIZATION_REGISTERED_ORIGINAL_REQUIRED");
  auto publicBefore=readOriginalPublicSameItem(old);source.assertCurrent();
  NSMutableDictionary*q=query();q[(__bridge id)kSecValuePersistentRef]=[[NSData alloc]initWithBase64EncodedString:ns(old.persistentRef) options:0];q[(__bridge id)kSecAttrAccount]=ns(publicBefore.account);q[(__bridge id)kSecReturnAttributes]=@YES;q[(__bridge id)kSecReturnPersistentRef]=@YES;q[(__bridge id)kSecReturnData]=@YES;q[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitAll;
  CFTypeRef raw=nullptr;const auto rc=AssocCopy((__bridge CFDictionaryRef)q,&raw);id result=CFBridgingRelease(raw);
  if(rc!=errSecSuccess||![result isKindOfClass:NSArray.class]||[result count]!=1||![[result firstObject]isKindOfClass:NSDictionary.class])fail("DEVICE_FINALIZATION_PRIVATE_ORIGINAL_REFUSED");
  NSDictionary*entry=[result firstObject];NSData*data=entry[(__bridge id)kSecValueData];if(![data isKindOfClass:NSData.class]||!data.length||data.length>24576)fail("DEVICE_FINALIZATION_PRIVATE_FRAME_BOUND");
  frame.material=[NSMutableData dataWithData:data];const auto observed=observe(entry,old.network);originalItem(old,observed);
  if(observed.account!=publicBefore.account||observed.osIdentity!=publicBefore.osIdentity||observed.metadata!=publicBefore.metadata)fail("DEVICE_FINALIZATION_PRIVATE_ITEM_REPLACED");
  const uint8_t*p=(const uint8_t*)frame.material.bytes;const size_t length=frame.material.length;size_t at=0;
  const std::string magic=observed.metadata.empty()?"YNX-DEVICE-PROVISION-PRIVATE/v4\n":"YNX-PRODUCT-DEVICE-PRIVATE/v4\n";if(length<magic.size()||memcmp(p,magic.data(),magic.size()))fail("DEVICE_FINALIZATION_PRIVATE_FRAME");at=magic.size();
  auto take=[&](size_t exact)->std::pair<const uint8_t*,size_t>{if(length-at<4)fail("DEVICE_FINALIZATION_PRIVATE_FRAME");uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|p[at++];if(n!=exact||n>length-at)fail("DEVICE_FINALIZATION_PRIVATE_FRAME");auto part=std::make_pair(p+at,(size_t)n);at+=n;return part;};
  if(!observed.metadata.empty()){if(observed.metadata!=r.associationOriginal||observed.account!="uid:"+std::to_string(uid_)+":network:"+old.network+":registration:"+hash(r.registrationOriginal))fail("DEVICE_FINALIZATION_REGISTERED_FRAME_BINDING");auto original=take(r.registrationOriginal.size());if(memcmp(original.first,r.registrationOriginal.data(),original.second))fail("DEVICE_FINALIZATION_REGISTERED_FRAME_BINDING");}
  const size_t sizes[]={54,150,2592,64};for(unsigned i=0;i<4;i++)frame.parts[i]=take(sizes[i]);if(at!=length||memcmp(frame.parts[2].first,old.publicPair.pa.data(),2592)||memcmp(frame.parts[3].first,old.publicPair.pb.data(),64))fail("DEVICE_FINALIZATION_PRIVATE_PAIR_CHANGED");
  assertIdentity(observed);source.assertRegisteredCurrent(r,old.publicPair);source.assertCurrent();return observed;
 }
public:
 DeviceAssociationIdentity readOriginalPublicSameItem(const DeviceAssociationIdentity&old)override{
  actor();if(old.persistentRef.empty()||old.persistentRef.size()>4096)fail("DEVICE_FINALIZATION_ORIGINAL_REF");NSMutableDictionary*q=query();q[(__bridge id)kSecValuePersistentRef]=[[NSData alloc]initWithBase64EncodedString:ns(old.persistentRef) options:0];auto observed=read(q,old.network);originalItem(old,observed);return observed;
 }
 DeviceAssociationIdentity readOriginalRegisteredOrPendingItem(const DeviceAssociationIdentity&old,const RegisteredDeviceAssociation&r,OriginalRegisteredDeviceFinalizationAuthority&source)override{PrivateFrame frame;return readPrivateOriginal(old,r,source,frame);}
 DeviceAssociationIdentity completeOriginalPendingRegistered(const DeviceAssociationIdentity&old,const RegisteredDeviceAssociation&r,OriginalRegisteredDeviceFinalizationAuthority&source)override{
  PrivateFrame original;const auto pending=readPrivateOriginal(old,r,source,original);if(!pending.metadata.empty())return pending;
  static const char magic[]="YNX-PRODUCT-DEVICE-PRIVATE/v4\n";NSMutableData*secret=[NSMutableData dataWithBytes:magic length:sizeof(magic)-1];SecretDataGuard wipe(secret);field(secret,r.registrationOriginal.data(),r.registrationOriginal.size());for(const auto&part:original.parts)field(secret,part.first,part.second);
  // Preserve exact existing DER/private bytes; metadata and private frame both
  // bind the same original operation + full public pair. No creator/Core sign.
  NSMutableData*generic=[NSMutableData data];for(const auto&s:{std::string("REGISTERED"),old.operation,r.associationOriginal})field(generic,s.data(),s.size());field(generic,old.publicPair.pa.data(),2592);field(generic,old.publicPair.pb.data(),64);
  NSMutableData*previous=[NSMutableData data];for(const auto&s:{std::string("PENDING"),old.operation,std::string("")})field(previous,s.data(),s.size());field(previous,old.publicPair.pa.data(),2592);field(previous,old.publicPair.pb.data(),64);
  assertIdentity(pending);source.assertRegisteredCurrent(r,old.publicPair);source.assertCurrent();
  NSMutableDictionary*q=query();q[(__bridge id)kSecValuePersistentRef]=[[NSData alloc]initWithBase64EncodedString:ns(old.persistentRef) options:0];q[(__bridge id)kSecAttrAccount]=ns(pending.account);q[(__bridge id)kSecAttrGeneric]=previous;
  NSDictionary*update=@{(__bridge id)kSecAttrAccount:ns("uid:"+std::to_string(uid_)+":network:"+old.network+":registration:"+hash(r.registrationOriginal)),(__bridge id)kSecAttrGeneric:generic,(__bridge id)kSecValueData:secret};
  const OSStatus rc=AssocUpdate((__bridge CFDictionaryRef)q,(__bridge CFDictionaryRef)update);if(rc!=errSecSuccess)fail("DEVICE_FINALIZATION_ASSOCIATION_UPDATE_UNKNOWN");
  source.assertRegisteredCurrent(r,old.publicPair);source.assertCurrent();PrivateFrame after;auto published=readPrivateOriginal(old,r,source,after);if(published.metadata.empty())fail("DEVICE_FINALIZATION_ASSOCIATION_READBACK_UNKNOWN");return published;
 }
