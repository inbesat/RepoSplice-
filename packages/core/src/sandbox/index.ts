// Sandbox surface barrel.
//
// `docker.ts` (P-067) is the daemon client + reachability probe; `client.ts`
// (P-168) is the container-lifecycle wrapper the Sandbox epic (P-169–P-180)
// builds on. Consumers import the whole sandbox surface from here, and the
// public package barrel re-exports it for cli/web.

export {
  SandboxClient,
  demuxDockerLogs,
  MAX_CONTAINER_LOG_LINES,
  DEFAULT_RUN_TIMEOUT_MS,
} from './client.js';
export type {
  ContainerSpec,
  ContainerRun,
  SandboxStats,
  SandboxClientOptions,
  SandboxClientFactoryOptions,
  PullOptions,
  RunOptions,
  DockerLike,
  ContainerLike,
  ContainerCreateOptionsLike,
  HostConfigLike,
} from './client.js';

export { createDockerClient, pingDocker, defaultDockerSocket } from './docker.js';
export type {
  DockerSandboxClient,
  DockerReachability,
  DockerClientOptions,
  DockerPingable,
} from './docker.js';

export { parseDockerEngineVersion, checkDockerDaemon } from './dockerProbe.js';
export type { DockerDaemonStatus } from './dockerProbe.js';
