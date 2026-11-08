#pragma once
#include "social_joint_profile_issuer_private.h"
#ifdef __cplusplus
extern "C"{
#endif
typedef struct finite_joint_composition finite_joint_composition;
/* Owns actual constructor outputs, not borrowed pointers. Native binding in
 * turn owns registered MainPair/DEVICE holders and their Source parent debt. */
void finite_joint_composition_open(uint64_t,ynx_social_joint_source_input_v1*,const unsigned char*,size_t,finite_joint_composition**,ynx_social_joint_status_v1*);
void finite_joint_composition_current(finite_joint_composition*,ynx_social_joint_status_v1*);
void finite_joint_composition_seal(finite_joint_composition*,uint32_t,ynx_social_joint_bytes_v1,ynx_social_joint_bytes_v1,ynx_social_joint_status_v1*);
/* Internal join done1 means binding children physically drained, NOT Source
 * closed. Caller keeps first failure separately and reports public join as an
 * operation completion. Full close returns its first + actual whole done. */
void finite_joint_composition_join(finite_joint_composition*,ynx_social_joint_status_v1*);
void finite_joint_composition_close(finite_joint_composition**,ynx_social_joint_status_v1*);
#ifdef __cplusplus
}
#endif
