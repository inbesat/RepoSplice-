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
  BuildImageOptions,
  RunOptions,
  DockerLike,
  ContainerLike,
  ContainerCreateOptionsLike,
  ImageBuildOptionsLike,
  HostConfigLike,
} from './client.js';

// P-169 — ephemeral image per ecosystem.
export {
  ECOSYSTEM_IMAGES,
  EPHEMERAL_PREFIX,
  SANDBOX_IMAGES_TABLE_SQL,
  imageFor,
  isEphemeralTag,
  ephemeralTagFor,
  ensureImage,
  clearImageCacheForTests,
} from './images.js';
export type { ImageClient, EnsureImageOptions } from './images.js';

// P-170 — install deps inside the sandbox.
export {
  installDeps,
  countInstalled,
  WORKSPACE_MOUNT,
  DEFAULT_INSTALL_TIMEOUT_MS,
  NODE_LOCKFILES,
} from './install.js';
export type { InstallSpec, InstallResult, InstallOptions, InstallClient } from './install.js';

// P-171 — run the ecosystem build inside the sandbox.
export {
  runBuild,
  boundLogLines,
  BUILD_COMMANDS,
  DEFAULT_OUTPUT_DIRS,
  DEFAULT_BUILD_TIMEOUT_MS,
  MAX_BUILD_LOG_LINES,
  BUILDOUT_MOUNT,
} from './build.js';
export type { BuildResult, RunBuildOptions, BuildClient } from './build.js';

// P-172 — run the ecosystem test suite inside the sandbox.
export {
  runTests,
  parseTestOutput,
  parseJunitXml,
  looksLikeJunit,
  TEST_COMMANDS,
  DEFAULT_TEST_TIMEOUT_MS,
  MAX_TEST_FAILURES,
} from './test.js';
export type {
  TestResult,
  TestFailure,
  RunTestsOptions,
  TestClient,
  ParsedTestCounts,
} from './test.js';

// P-173 — capture logs and artifacts, bounded and run-scoped.
export {
  CaptureManager,
  hostArtifactPath,
  sanitizeSegment,
  DEFAULT_LOG_CAPACITY,
  DEFAULT_MAX_ARTIFACT_BYTES,
  CAPTURE_RUNS_TABLE_SQL,
} from './capture.js';
export type {
  LogEntry,
  LogSink,
  CaptureResult,
  CaptureRunRecord,
  CaptureOptions,
  CaptureRunOptions,
  CaptureClient,
} from './capture.js';

// P-174 — timeout and resource limits.
export {
  DEFAULT_LIMITS,
  STRICT_LIMITS,
  applyLimits,
  enforceTimeout,
  defaultLimits,
  limitsToCaptureOptions,
  parseMemoryToMb,
  parseCpuCount,
} from './limits.js';
export type { LimitsConfig, LimitsConfigSource } from './limits.js';

// P-175 — GitHub Actions fallback + the verification dispatcher.
export {
  fallbackSelection,
  renderWorkflow,
  runViaGitHubActions,
  DEFAULT_WORKFLOW_FILE,
  WORKFLOW_PLACEHOLDERS,
} from './fallback.js';
export type {
  BackendChoice,
  SelectionSource,
  WorkflowValues,
  GitHubFallbackOptions,
} from './fallback.js';
export { runVerification } from './runner.js';
export type { VerificationKind, RunVerificationOptions } from './runner.js';

export { createDockerClient, pingDocker, defaultDockerSocket } from './docker.js';
export type {
  DockerSandboxClient,
  DockerReachability,
  DockerClientOptions,
  DockerPingable,
} from './docker.js';

export { parseDockerEngineVersion, checkDockerDaemon } from './dockerProbe.js';
export type { DockerDaemonStatus } from './dockerProbe.js';
