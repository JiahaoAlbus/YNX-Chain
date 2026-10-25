#include <stddef.h>
/* Fixed private buffer cleanup only; not proof of library/physical erasure. */
void ynx_auth_native_wipe_v1(void *buffer,size_t length){volatile unsigned char*p=buffer;while(length--)*p++=0;}
