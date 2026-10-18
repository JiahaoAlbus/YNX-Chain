// Depends on the existing private record reader and strict Boolean helpers.
static BOOL YNXNativeIdentityStatus(id record,NSDictionary *row) {
    BOOL failed=[record isKindOfClass:NSDictionary.class]&&[record[@"phase"]isEqual:@"failed"];
    NSArray *keys=failed?@[@"schema",@"id",@"document",@"instance",@"projectId",@"workspace",@"kind",@"phase",@"dataOnly",@"authorized",@"errorCode"]:@[@"schema",@"id",@"document",@"instance",@"projectId",@"workspace",@"kind",@"phase",@"dataOnly",@"authorized"];
    if(!YNXOriginalServiceFields(record,keys)||![record[@"schema"]isEqual:@"ynx-ide-native-identity-status/v1"]
       ||!YNXOriginalServiceBool(record[@"dataOnly"],YES)||!YNXOriginalServiceBool(record[@"authorized"],NO))return NO;
    for(NSString *key in @[@"id",@"document",@"instance",@"projectId",@"workspace",@"kind"])
        if(![record[key]isEqual:row[key]])return NO;
    if(!failed)return [record[@"phase"]isEqual:@"response-received"];
    NSString *code=record[@"errorCode"];
    return [code isKindOfClass:NSString.class]&&code.length>0&&code.length<=100
       &&[code rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"]invertedSet]].location==NSNotFound;
}
