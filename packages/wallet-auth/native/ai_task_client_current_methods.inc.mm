+ (instancetype)acquireOriginalAITaskActionV6ClientProfile:(NSError**)error {
 YNXAuthIdentityCurrentOwner*o=[self new];o->_aiTaskClient=YES;o->_ideRegistry=YES;
 try{@try{(void)[o capture:error];return o;}@catch(NSException*){[o fail:@"AI_V6_CLIENT_PROFILE_EXCEPTION" error:error];return o;}}
 catch(...){[o fail:@"AI_V6_CLIENT_PROFILE_CPP_EXCEPTION" error:error];return o;}
}
