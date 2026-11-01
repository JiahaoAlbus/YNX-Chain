#import "native_consent.m"
#import <string.h>

// A separate fixed native executable keeps the prompt signature independent
// of the helper and outer App seal. No path, command or presenter is selectable.
int main(int argc,const char **argv) {
    if(argc!=2||strcmp(argv[1],"--native-consent")!=0) {
        fputs("FIXED_NATIVE_CONSENT_MODE_REQUIRED\n",stderr);return 2;
    }
    return QANativeConsentMain();
}
