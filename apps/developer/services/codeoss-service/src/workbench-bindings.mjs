import { isAbsolute, resolve, join } from 'node:path';
import { validateRuntimeContext } from './admission.mjs';
import { validateRuntimeArtifact, sameRuntimeArtifact } from './composed-runtime.mjs';

// Consumed by the registered operator driver after admission and protected-tree
// verification. These opaque locators grant no identity, network or signing
// authority. Never spread a Gateway/request environment into the runtime.
export function composedWorkbenchBindings(context, { artifactRoot, runtimeArtifact } = {}) {
  validateRuntimeContext(context);
  const artifact = validateRuntimeArtifact(runtimeArtifact);
  if (!sameRuntimeArtifact(context.image, artifact)) throw Error('Workbench artifact does not match the durable runtime.');
  if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot) || resolve(artifactRoot) !== artifactRoot || artifactRoot.includes('\0'))
    throw Error('Provide the exact protected composed artifact directory.');
  const workspaceDirectory = join(context.projectDirectory, 'workspace');
  const profileDirectory = join(context.projectDirectory, 'profile');
  const pluginsDirectory = join(artifactRoot, 'plugins');
  return Object.freeze({ workspaceDirectory, profileDirectory, pluginsDirectory,
    environment: Object.freeze({
      THEIA_APP_PROJECT_PATH: artifactRoot,
      THEIA_CONFIG_DIR: profileDirectory,
      THEIA_DEFAULT_PLUGINS: `local-dir:${pluginsDirectory}`,
      YNX_CORE_SESSION_ID: context.sessionId,
      YNX_CORE_WORKSPACE: workspaceDirectory,
    }),
  });
}
