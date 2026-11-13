// Included in original CurrentOwner TU AFTER native release/OS headers.
static NSURL *YNXOriginalBrowserPageRegistryResources(){
 if(getuid()==0||getuid()!=geteuid()||getgid()!=getegid())return nil;
 const ynx::browser::page::BrowserPageSourceRelease*selected=nullptr;
 for(const auto&p:ynx::browser::page::original_browser_page_releases())
  if(p.source.purpose=="browser-selected-pages-source-v1"&&p.uid==getuid()){
   if(selected)return nil;selected=&p;
  }
 if(!selected||selected->application_id!="com.ynxweb4.browser.macos"||selected->product_id!="browser"||
    selected->platform!="macos"||selected->resource_directory.empty())return nil;
 NSString*p=[NSString stringWithUTF8String:selected->resource_directory.c_str()];
 char canonical[PATH_MAX];if(!p.isAbsolutePath||!realpath(p.fileSystemRepresentation,canonical)||
    ![p isEqual:[NSString stringWithUTF8String:canonical]])return nil;
 return [NSURL fileURLWithPath:p isDirectory:YES];
}
