+ (instancetype)acquireOriginalNetworkCurrentPublisherProfile:(NSError**)error{
 YNXAuthIdentityCurrentOwner*owner=[self new];owner->_networkPublisher=YES;owner->_ideRegistry=YES;
 try{@try{(void)[owner capture:error];return owner;}@catch(NSException*){[owner fail:@"NETWORK_PUBLISHER_PROFILE_EXCEPTION" error:error];return owner;}}
 catch(...){[owner fail:@"NETWORK_PUBLISHER_PROFILE_CPP_EXCEPTION" error:error];return owner;}
}
