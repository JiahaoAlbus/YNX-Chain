import assert from "node:assert/strict";import test from "node:test";import{FORBIDDEN_AUTOMATION,validateAISelection}from"./aiPolicy";
test("AI requires bounded explicit context",()=>{assert.equal(validateAISelection("translation",["message-1"],"One selected message is shared.").selectionIds.length,1);assert.throws(()=>validateAISelection("reply_draft",[],"Nothing is shared."),/Select/)});
test("AI cannot perform social side effects",()=>assert.deepEqual(FORBIDDEN_AUTOMATION,["send_message","publish_post","follow","block","report","moderate"]));
