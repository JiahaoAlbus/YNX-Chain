+ (instancetype)acquireOriginalDeviceV4ManagementProfile:(NSError**)error{
 YNXAuthIdentityCurrentOwner*o=[self new];o->_deviceManagement=YES;o->_ideRegistry=YES;
 try{@try{(void)[o capture:error];return o;}@catch(NSException*){[o fail:@"DEVICE_MANAGEMENT_V4_PROFILE_EXCEPTION" error:error];return o;}}
 catch(...){[o fail:@"DEVICE_MANAGEMENT_V4_PROFILE_CPP_EXCEPTION" error:error];return o;}
}
