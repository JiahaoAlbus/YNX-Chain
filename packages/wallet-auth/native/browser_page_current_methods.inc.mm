+ (instancetype)acquireOriginalBrowserSelectedPagesProfile:(NSError**)error {
 YNXAuthIdentityCurrentOwner*o=[self new];o->_browserPages=YES;o->_ideRegistry=YES;
 try{@try{(void)[o capture:error];return o;}
 @catch(NSException*){[o fail:@"BROWSER_PAGE_PROFILE_EXCEPTION" error:error];return o;}}
 catch(...){[o fail:@"BROWSER_PAGE_PROFILE_CPP_EXCEPTION" error:error];return o;}
}
