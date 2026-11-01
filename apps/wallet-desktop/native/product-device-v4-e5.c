#include "ProductSessionDeviceV4.h"
#include <stdint.h>
#include <string.h>
static int region(const void*p,size_t n){return p&&n&&n<=UINTPTR_MAX-(uintptr_t)p;}
static int apart(const void*a,size_t an,const void*b,size_t bn){return region(a,an)&&region(b,bn)&&((uintptr_t)a+an<=(uintptr_t)b||(uintptr_t)b+bn<=(uintptr_t)a);}
static void be32(uint8_t*p,uint32_t n){p[0]=(uint8_t)(n>>24);p[1]=(uint8_t)(n>>16);p[2]=(uint8_t)(n>>8);p[3]=(uint8_t)n;}
int32_t ynx_auth_device_http_v4_e5_data(const uint8_t network[32],const uint8_t owner[42],const uint8_t*request,size_t n,uint8_t*out,size_t cap,size_t*written){
 static const uint8_t domain[]="YNX-PRODUCT-SESSION-HTTP-PROOF/v4";
 const size_t overhead=4+5*4+(sizeof(domain)-1)+4+32+42;
 if(!region(network,32)||!region(owner,42)||!region(request,n)||n>YNX_AUTH_DEVICE_V4_MESSAGE_MAX-overhead||!region(out,cap)||cap>YNX_AUTH_DEVICE_V4_MESSAGE_MAX||cap<overhead+n||!region(written,sizeof(*written))||(uintptr_t)written%_Alignof(size_t))return 1;
 const void*inputs[]={network,owner,request};const size_t sizes[]={32,42,n};
 for(unsigned i=0;i<3;i++)if(!apart(out,cap,inputs[i],sizes[i])||!apart(written,sizeof(*written),inputs[i],sizes[i]))return 1;
 if(!apart(out,cap,written,sizeof(*written)))return 1;
 if(owner[0]!='0'||owner[1]!='x')return 1;
 for(unsigned i=2;i<42;i++)if(!((owner[i]>='0'&&owner[i]<='9')||(owner[i]>='a'&&owner[i]<='f')))return 1;
 uint8_t version[]={0,0,0,4};const uint8_t*parts[]={domain,version,network,owner,request};const size_t lengths[]={sizeof(domain)-1,4,32,42,n};
 size_t at=4;be32(out,5);for(unsigned i=0;i<5;i++){be32(out+at,(uint32_t)lengths[i]);at+=4;memcpy(out+at,parts[i],lengths[i]);at+=lengths[i];}
 *written=at;return 0;
}
