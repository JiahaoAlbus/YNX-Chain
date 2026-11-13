static NSURL*YNXOriginalDeviceV4ManagementRegistryResources(){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 const ynx::device::management::SourceRelease*selected=nullptr;
 for(const auto&p:ynx::device::management::original_management_releases())if(p.uid==getuid()&&p.source.purpose=="product-device-management-source-v4"){
  if(selected)return nil;selected=&p;
 }
 if(!selected||selected->application_id.empty()||selected->product_id.empty()||selected->platform!="macos"||selected->resource_directory.empty())return nil;
 NSString*p=[NSString stringWithUTF8String:selected->resource_directory.c_str()];char canonical[PATH_MAX];
 if(!p.isAbsolutePath||!realpath(p.fileSystemRepresentation,canonical)||![p isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return[NSURL fileURLWithPath:p isDirectory:YES];
}
