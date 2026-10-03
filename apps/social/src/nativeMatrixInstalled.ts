import { requireOptionalNativeModule } from 'expo';
import type { NativeMatrixBridge, MatrixBinding, MatrixPeer } from './nativeMatrix';
import { NativeMatrixConsumer } from './nativeMatrix';

export function installedMatrixConsumer(current: () => Promise<MatrixBinding>,
  acceptedPeer: (personId: string) => Promise<MatrixPeer>) {
  const bridge = requireOptionalNativeModule<NativeMatrixBridge>('YNXSocialMatrix');
  if (!bridge) throw new Error('MATRIX_NATIVE_BUILD_REQUIRED');
  return new NativeMatrixConsumer(bridge, current, acceptedPeer);
}
