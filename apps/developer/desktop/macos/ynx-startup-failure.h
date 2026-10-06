#import <Foundation/Foundation.h>

// Reserved by the local launcher's plugin preparation catch only. Generic
// failures and child-runtime exit codes are never evidence of disk capacity.
static NSString *YNXLocalStartupExitMessage(int code, BOOL exitedNormally, BOOL editorLoaded, NSString *locale, NSString *logPath) {
    NSString *log=logPath?:@"unavailable";
    if(code==74&&exitedNormally&&!editorLoaded){
        if([locale isEqual:@"zh-cn"])return [NSString stringWithFormat:@"系统盘或 IDE 数据所在磁盘空间不足，暂时无法启动 YNX Developer。请释放该磁盘空间后重新打开项目。你仍可通过「文件 → 打开文件夹…」选择项目，无需移动项目或清空设置。\n日志：%@",log];
        return [NSString stringWithFormat:@"There is not enough space on the system disk or the disk containing IDE data to start YNX Developer. Free space on that disk, then reopen the project. File → Open Folder… remains available. You do not need to move your project or clear settings.\nLog: %@",log];
    }
    return [NSString stringWithFormat:@"Local server exited with code %d. Log: %@",code,log];
}
