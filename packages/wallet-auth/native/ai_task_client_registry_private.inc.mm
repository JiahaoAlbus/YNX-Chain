static NSURL*YNXOriginalAITaskClientRegistryResources(){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 const ynx::ai::client::SourceRelease*selected=nullptr;
 for(const auto&p:ynx::ai::client::original_releases())if(p.uid==getuid()&&p.source.purpose=="ai-native-task-action-source-v6"){
  if(selected)return nil;selected=&p;
 }
 if(!selected||selected->application_id!="com.ynxweb4.ai"||selected->product_id!="ai"||
    (selected->platform!="ios"&&selected->platform!="android")||selected->resource_directory.empty())return nil;
 NSString*p=[NSString stringWithUTF8String:selected->resource_directory.c_str()];char canonical[PATH_MAX];
 if(!p.isAbsolutePath||!realpath(p.fileSystemRepresentation,canonical)||![p isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return[NSURL fileURLWithPath:p isDirectory:YES];
}
