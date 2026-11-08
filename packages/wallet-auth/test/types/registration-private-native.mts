import factory,{type FixedNativeHost}from'../../native/original-device-v4-registration-private-factory.mjs';
import{inspectNativeDrainDATA}from'../../native/original-device-v4-registration-native-data.mjs';
declare const host:FixedNativeHost;
const open=factory(host),client=await open();await client.prepareOriginalPairSubmission();
// @ts-expect-error fixed public-private opener has no caller inputs
await open({});
// @ts-expect-error no caller Source/provider in prepare
await client.prepareOriginalPairSubmission({source:{}});
const done=inspectNativeDrainDATA({});const physical:0|1=done.physical_done;const first:0|1=done.failure.present;void physical;void first;
