#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C"{
#endif
typedef struct finite_joint_journal finite_joint_journal;
typedef struct{const unsigned char*data;size_t size;} finite_joint_span;
typedef struct{unsigned char history[32],canonical_role[32],source_resource[32],binding_resource[32];uint32_t role;finite_joint_span body,frame;} finite_joint_intent;
/* Private storage only; never exported as Root/Source/permission. */
int finite_joint_journal_open(int,const finite_joint_intent*,finite_joint_journal**);
/* Normal producer MUST use SAME Root-selected path, never caller path. */
int finite_joint_journal_open_bound(int,const char*,size_t,const finite_joint_intent*,finite_joint_journal**);
int finite_joint_journal_enter(finite_joint_journal*);
int finite_joint_journal_probe(finite_joint_journal*);
int finite_joint_journal_current(finite_joint_journal*);
int finite_joint_journal_retain(finite_joint_journal*,uint32_t,const unsigned char*,size_t);
int finite_joint_journal_terminal(finite_joint_journal*);
int finite_joint_journal_query(finite_joint_journal*,unsigned char*,size_t,size_t*);
int finite_joint_journal_close(finite_joint_journal**);
#ifdef __cplusplus
}
#endif
