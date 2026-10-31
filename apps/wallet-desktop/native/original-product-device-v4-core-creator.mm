#include "original-product-device-v4-provisioning.h"
#include "product_device_keypair_v4.h"
namespace ynx_auth_private {
class OriginalCoreDeviceOnlyCreator final:public OriginalDeviceOnlyCreator{
 bool attempted_=false;
public:DeviceCreationOutcome create(DeviceCreatedPair&p)override{
  if(attempted_)return{};attempted_=true;
  YNXProductSessionDeviceKeypairRequestV4 request{};
  request.version=YNX_PRODUCT_DEVICE_KEYPAIR_VERSION_V4;
  request.struct_size=sizeof(request);
  request.pkcs8_a={p.a.data(),p.a.size()};request.pkcs8_b={p.b.data(),p.b.size()};
  request.pk_a={p.pa.data(),p.pa.size()};request.pk_b={p.pb.data(),p.pb.size()};
  YNXProductSessionDeviceKeypairOutcomeV4 outcome{};
  const int32_t rc=YNXProductSessionDeviceKeypairGenerateV4(&request,&outcome);
  // Capture actual reported lengths/cleanup/state before rc interpretation.
  // The owner imports/clears p, including every UNKNOWN partial; no retry.
  return{rc,outcome.cleanup_status,outcome.output_state,{outcome.pkcs8_a_length,outcome.pkcs8_b_length,outcome.pk_a_length,outcome.pk_b_length}};
 }
};
std::unique_ptr<OriginalDeviceOnlyCreator>openOriginalCoreDeviceOnlyCreator(){return std::make_unique<OriginalCoreDeviceOnlyCreator>();}
}
