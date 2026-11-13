static NSURL*YNXOriginalNetworkCurrentPublisherResources(){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 const ynx::network::publisher::Release*selected=nullptr;
 for(const auto&r:ynx::network::publisher::releases())if(r.uid==getuid()&&r.source.purpose==ynx::network::publisher::purpose){if(selected)return nil;selected=&r;}
 if(!selected||selected->resourceDirectory.empty()||selected->applicationId.empty()||selected->platform!="macos")return nil;
 NSString*p=[NSString stringWithUTF8String:selected->resourceDirectory.c_str()];char canonical[PATH_MAX];
 if(!p.isAbsolutePath||!realpath(p.fileSystemRepresentation,canonical)||![p isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return[NSURL fileURLWithPath:p isDirectory:YES];
}
