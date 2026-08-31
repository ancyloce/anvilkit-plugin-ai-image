# @anvilkit/plugin-ai-image

> **Alpha (`0.1.4`).** API may change before `1.0`. The plugin never talks to an
> AI service directly — every job is delegated to a host-supplied
> `AiImageProvider`, so no credentials, model identifiers, or endpoints cross the
> plugin boundary.

AI image generation plugin for AnvilKit **Canvas Studio**. It wraps a
host-supplied `AiImageProvider` so the editor can issue text-to-image, variation,
inpaint, background-removal, and upscale jobs through one typed contract — and
ships the surrounding building blocks (abort/retry/poll job client, mock
provider, mask editor, post-processing pipeline, canvas commit helper, and an
optional React sidebar panel) as separate subpath exports.

> **Status.** The Iteration 1 building blocks all ship: the job client
> (`./` — `createAiJobClient`), the mock provider (`./mock`), the mask editor
> (`./mask`), the post-processing pipeline (`./post-process`), the commit helper
> (`./commit`), and the React sidebar surface (`./react`). The bare
> `createAiImagePlugin` factory validates the provider and exposes an imperative
> `submit()` method, but registers an empty Studio hook block — it does not yet
> contribute lifecycle hooks or UI on its own. Mount the panel via
> `@anvilkit/plugin-ai-image/react` (or wire your own UI on top of `useAiImage`).

PLAN-0039 E7 adds the complete product workflow around those primitives:
provider capability/limit discovery, progress and structured retry, explicit
original/result review, atomic replace or insert-copy, document-scoped recovery,
permission/connectivity handling, provider-policy fail-closed behavior,
host-bounded prompt retention, content-free telemetry, and deterministic image
quality fixtures. A completed provider job never mutates the document until the
user accepts its preview.

## Scope decision: this package fulfills the PRD's `@anvilkit/canvas-ai` role

**Decision (canvas-m4-002, FR-051): no new `@anvilkit/canvas-ai` package.**
`@anvilkit/plugin-ai-image` is the AI provider adapter package the PRD's
architecture diagram describes as a future `@anvilkit/canvas-ai`. It already
had the mock provider, the abort/retry/poll job client, a real non-mock
provider wired in `apps/studio` (Replicate), a mask editor, a post-process
pipeline, and a canvas-commit path before this decision was made — splitting
that into a second package would be pure churn for no capability gained
(reuse-first: extend what exists rather than duplicate it under a new name).

This decision also covers design-level jobs (canvas-m4-001's
`AiDesignJobRequest`/`AiDesignJobResult`): `createAiJobClient` is generic over
the request/result/context types (defaulting to the original image-job types,
so no existing call site changes), so the same abort/retry/poll guarantees
drive an `AiDesignProvider` exactly like an `AiImageProvider`. `AiDesignProvider`
stays a bare function type, sibling to `AiImageProvider`, rather than
generalizing to an `AssetSourceProvider`-style object interface — restructuring
the already-widely-consumed `AiImageProvider` now would be a breaking change
for no behavioral gain. Capability discovery (`AiProviderCapabilities`,
`@anvilkit/canvas-core`) is separate, additive metadata a host supplies
alongside its provider(s) — `AiImagePanel`'s `capabilities` prop uses it to
show only the ops a given provider actually supports.

## Installation

```sh
pnpm add @anvilkit/plugin-ai-image react react-dom @puckeditor/core
```

Peer dependencies: `react >=19.0.0`, `react-dom >=19.0.0`,
`@puckeditor/core ^0.23.0`, `@anvilkit/ui` (for the React panel), and
`konva ^10` + `react-konva ^19` (for the `./mask` and `./react` Konva
surfaces). The headless `.` entry — factory, job client, post-process, commit —
does not require Konva. `@anvilkit/canvas-core` ships as a direct dependency and
is the source of truth for the wire-shape types.

Subpath imports:

| Subpath                                  | Exports                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `@anvilkit/plugin-ai-image`              | `createAiImagePlugin`, `createAiJobClient`, `RetryableError`, `commitImageReplace`, mask exporter utilities, and all wire-shape types. |
| `@anvilkit/plugin-ai-image/react`        | `AiImagePanel`, `useAiImage`, `createAiImageSidebarPlugin`.                             |
| `@anvilkit/plugin-ai-image/mask`         | `MaskEditorLayer`, `useMaskStrokes`, mask types.                                       |
| `@anvilkit/plugin-ai-image/post-process` | `createPostProcessPipeline` + image helpers (`dataUrlToFile`, `sourceToFile`, `thumbnailDimensions`, `PostProcessError`). |
| `@anvilkit/plugin-ai-image/commit`       | `commitImageReplace`.                                                                  |
| `@anvilkit/plugin-ai-image/mock`         | `createMockAiImageProvider` for tests and demos.                                       |

## Quickstart

```ts
import { createAiImagePlugin } from "@anvilkit/plugin-ai-image";
import type { AiImageProvider } from "@anvilkit/plugin-ai-image";

const provider: AiImageProvider = async (request, context, options) => {
  // Call your AI service of choice (Replicate, OpenAI, self-hosted SD, ...).
  // Honour `options?.signal` for cancellation and return an AiImageJobResult.
  const res = await fetch("/api/ai/image", {
    method: "POST",
    body: JSON.stringify({ request, context }),
    signal: options?.signal,
  });
  return res.json();
};

export const aiImage = createAiImagePlugin({ provider });

// Imperative submit (delegates straight to your provider):
const result = await aiImage.submit(
  { kind: "text-to-image", prompt: "a calm mountain lake at dawn" },
  { artboardId: "artboard-1" },
);
```

## Core features

- **One typed provider contract** — nine job kinds (`text-to-image`,
  `variation`, `inpaint`, `bg-remove`, `upscale`, and canvas-m4-001's
  `generative-fill`, `generative-expand`, `object-erase`, `background-replace`)
  flow through a single `AiImageProvider` callback, all shown in `AiImagePanel`'s
  op selector by default (UX-006: generate / remove / replace / expand
  background). `capabilities.imageOps` (FR-051) narrows the selector to what a
  given provider actually implements. No credentials or model identifiers
  cross the plugin boundary.
- **Abort / retry / poll job client** — `createAiJobClient` wraps a provider with
  transient-failure retry (exponential backoff + jitter) and optional polling for
  async jobs that return `status: "pending"`.
- **Recoverable, nondestructive review** — `useAiImage` and `AiImagePanel` keep
  completed output in an original/result preview with explicit Replace, Insert
  as copy, and Discard decisions. The `@anvilkit/plugin-ai-image/job-session`
  entry keeps jobs alive across panel closure, isolates documents, restores
  safe reload state, and invalidates work on connectivity or permission changes.
- **Safety and privacy boundaries** — blocked/review-required provider outcomes
  cannot be previewed or applied. Storage adapters redact prompts and provider
  detail; in-memory prompt retention follows the host TTL. The bundle-isolated
  `@anvilkit/plugin-ai-image/telemetry` entry emits only task kind, duration,
  outcome, retry count, and apply/discard state.
- **Quality evaluation fixtures** — the bundle-isolated
  `@anvilkit/plugin-ai-image/evaluation` entry exports
  `AI_IMAGE_QUALITY_FIXTURES` and `evaluateAiImageQualityFixture` for transparent
  edges, boundary objects, embedded typography, faces, and generative-expansion
  seams without adding fixture bytes to the runtime plugin entry.
- **Mask editor** — `MaskEditorLayer` + `useMaskStrokes` capture brush strokes on a
  Konva layer; the exporter rasterizes them to a mask asset for inpaint jobs.
- **Post-processing pipeline** — normalize → validate MIME → validate size →
  optional compress → register main asset → generate + register thumbnail.
- **Canvas commit helper** — `commitImageReplace` builds a typed
  `image.replace` command for the host's canvas command bus.
- **React sidebar panel** — `AiImagePanel` + the self-registering
  `createAiImageSidebarPlugin` drop the generation UI into the Studio sidebar's
  `copilot` module.
- **Design actions (FR-053, canvas-m4-004)** — `AiImagePanel` also surfaces
  rewrite-selected-text, generate-layout-variants, and apply-brand-kit-via-AI
  when the host supplies `designJobClient` (an `AiJobClient` typed for
  `AiDesignJobRequest`/`AiDesignJobResult`, canvas-m4-001) and, for the brand
  action, `brandKit`. Each action builds its request, runs it through the same
  abort/retry/poll `AiJobClient` as image ops (`useAiDesign` mirrors
  `useAiImage`'s status/result/error/cancel shape), and — on completion —
  validates the result (canvas-m4-003's quarantine layer) before committing it
  via `designCommit`. `capabilities.designOps` (FR-051) conditionally hides
  actions the host's provider doesn't support; rewrite-copy additionally hides
  itself when `AiLayerContext.selectedNodeKind` names a non-text node.
- **Deterministic mock** — `createMockAiImageProvider` simulates latency and
  per-kind results (and forced failures) for tests and demos.

## API reference

### Factory

```ts
function createAiImagePlugin(
  opts: AiImagePluginOptions,
): StudioPlugin & AiImagePluginInstance;

interface AiImagePluginOptions {
  provider: AiImageProvider; // required — throws TypeError if not a function
}

interface AiImagePluginInstance {
  submit(
    request: AiImageJobRequest,
    context: AiLayerContext,
    options?: { signal?: AbortSignal },
  ): Promise<AiImageJobResult>;
}
```

`submit()` delegates directly to the configured `provider`. The returned object is
also a `StudioPlugin`; its `register()` currently returns an empty `hooks` block.

### Wire-shape types (re-exported from `@anvilkit/canvas-core`)

```ts
type AiImageJobRequest =
  | { kind: "text-to-image"; prompt: string; negativePrompt?: string; width?: number; height?: number; seed?: number }
  | { kind: "variation"; sourceAssetId: string; strength?: number; seed?: number }
  | { kind: "inpaint"; sourceAssetId: string; maskAssetId: string; prompt: string; seed?: number }
  | { kind: "bg-remove"; sourceAssetId: string }
  | { kind: "upscale"; sourceAssetId: string; scale?: number };

type AiImageJobKind = AiImageJobRequest["kind"];
type AiImageJobStatus = CanvasAiPlaceholderStatus | "cancelled";

interface AiImageJobResult {
  jobId: string;
  status: AiImageJobStatus;
  resultAssetId?: string;
  error?: { code: string; message: string };
  startedAt: number;
  finishedAt?: number;
}

interface AiLayerContext {
  artboardId: string;
  selectedNodeId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

type AiImageProvider = (
  request: AiImageJobRequest,
  context: AiLayerContext,
  options?: { signal?: AbortSignal },
) => Promise<AiImageJobResult>;
```

These live in `@anvilkit/canvas-core` so the headless IR and this plugin agree on
the wire shape; the package re-exports them for ergonomics.

### Job client (`.`)

```ts
function createAiJobClient(options: AiJobClientOptions): AiJobClient;

interface AiJobClient {
  run(
    request: AiImageJobRequest,
    context: AiLayerContext,
    options?: { signal?: AbortSignal },
  ): Promise<AiImageJobResult>;
}
```

| `AiJobClientOptions` field | Type             | Default     | Purpose                                                                 |
| -------------------------- | ---------------- | ----------- | ----------------------------------------------------------------------- |
| `provider`                 | `AiImageProvider`| _required_  | Host-supplied provider.                                                 |
| `poll`                     | `AiJobPollFn`    | none        | Poller for async jobs. When the provider returns non-terminal `pending` and `poll` is set, the client polls until terminal/aborted/timed out. |
| `pollIntervalMs`           | `number`         | `1000`      | Delay between poll attempts.                                            |
| `pollTimeoutMs`            | `number`         | none        | Wall-clock budget for the poll loop; on overrun resolves to an `error` result with code `TIMEOUT`. |
| `maxRetries`               | `number`         | `3`         | Retry attempts after the initial call (transient failures only).       |
| `baseDelayMs`              | `number`         | `250`       | Base backoff delay.                                                     |
| `maxDelayMs`               | `number`         | `8000`      | Cap on backoff before jitter.                                          |
| `jitter` / `sleep` / `now` | functions        | platform    | Injection points for deterministic tests.                              |

Aborting `options.signal` resolves to a `cancelled` result. Throw `RetryableError`
from a provider to mark a failure as transient and eligible for the backoff loop.

### Mask editing (`./mask`)

| Export            | Signature                                                   | Purpose                                              |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `MaskEditorLayer` | React (`react-konva`) component                             | Brush-stroke capture layer for inpaint masks.        |
| `useMaskStrokes`  | `(options?: UseMaskStrokesOptions) => UseMaskStrokesResult` | Stroke state + pointer handlers for the mask layer.  |

### Mask export (root entry)

The mask rasterization/upload helpers are exported from the root entry
(`@anvilkit/plugin-ai-image`), not the `./mask` subpath:

| Export                       | Signature                                                       | Purpose                                                            |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `createMaskToAssetExporter`  | `(options: MaskToAssetExporterOptions) => MaskToAssetExporter`  | `.export(strokes, dimensions)` rasterizes + uploads, resolving to the mask asset id. |
| `drawMask`                   | `(ctx, strokes, options?) => void`                              | Low-level mask rasterization onto a 2D context.                    |
| `rasterizeMaskToDataUrl`     | `(input: RasterizeMaskInput) => string`                         | Render strokes to a PNG data URL.                                  |
| `dataUrlToFile`              | `(dataUrl: string, filename: string) => File`                   | Convert a data URL to a `File` for upload.                         |

### Post-processing (`./post-process`)

```ts
function createPostProcessPipeline(
  options: PostProcessOptions,
): PostProcessPipeline; // .process(source) => Promise<PostProcessResult>
```

| `PostProcessOptions` field | Type                        | Default | Purpose                                                          |
| -------------------------- | --------------------------- | ------- | ---------------------------------------------------------------- |
| `upload`                   | `PostProcessUpload`         | _required_ | Host upload fn; called for both the main image and the thumbnail. |
| `acceptedMimeTypes`        | `readonly string[]`         | none    | MIME allowlist; non-matching sources throw `PostProcessError`.   |
| `maxBytes`                 | `number`                    | none    | Size cap.                                                        |
| `thumbnail`                | `{ maxEdge?; mimeType? }`   | `maxEdge: 256` | Thumbnail dimensions / format (always generated).        |
| `compress`                 | `{ mimeType?; quality? }`   | none    | Opt-in re-encode (e.g. to `image/webp`).                         |
| `createCanvas` / `decodeImage` | functions               | platform | Injection points for non-DOM / test environments.            |
| `filename`                 | `string`                    | none    | Base filename for the uploaded asset.                            |

`PostProcessResult` returns `{ assetId, thumbnailAssetId, mimeType, bytes, width, height }`.
Helpers `dataUrlToFile`, `sourceToFile`, `thumbnailDimensions`, and the
`PostProcessError` class are exported alongside.

### Commit (`./commit`)

```ts
function commitImageReplace<T = unknown>(
  options: CommitImageReplaceOptions<T>,
): T;

interface CommitImageReplaceOptions<T = unknown> {
  commit: (cmd: CanvasImageReplaceCommand) => T; // CommitCanvasCommandFn<T>
  nodeId: string;
  fromAssetId: string;
  toAssetId: string;
}
```

Builds an `image.replace` canvas command and hands it to the host's `commit`
function (e.g. `(cmd) => historyStore.getState().commit(currentIr, cmd)`),
returning whatever that function returns.

### React (`./react`)

```ts
function AiImagePanel(props: AiImagePanelProps): ReactElement;
function useAiImage(options: UseAiImageOptions): UseAiImageResult;
function createAiImageSidebarPlugin(
  options: CreateAiImageSidebarPluginOptions,
): StudioPlugin;
```

- **`AiImagePanel`** — the generation UI (provider-driven tasks and constraints,
  prompt fields/examples, progress/cancel/retry, structured errors, and
  original/result review with replace/insert-copy/discard). Driven by a
  `jobClient`, a `getLayerContext` accessor, an optional `defaultOp`, and
  injectable i18n `labels`.
- **`useAiImage`** — headless panel-state hook returning field values, change
  handlers, lifecycle actions, and explicit preview decisions. Optional
  `jobSession` and `telemetry` adapters add recovery and content-free reporting.
  Wire it to your own UI when `AiImagePanel`'s chrome doesn't fit.
- **`createAiImageSidebarPlugin`** — self-registering plugin that mounts
  `AiImagePanel` into the Studio sidebar's `copilot` module. Options:

  | Field            | Type                                  | Default          | Purpose                                                            |
  | ---------------- | ------------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `jobClient`      | `AiJobClient`                         | _required_       | Drives jobs (recommended: from `createAiJobClient`).               |
  | `getLayerContext`| `() => AiLayerContext \| null`        | `() => null`     | Live active-artboard / selection accessor. `null` disables Run.    |
  | `defaultOp`      | `AiImageJobKind`                      | `"text-to-image"`| Op selected on first render.                                       |
  | `labels`         | i18n copy                             | none             | Forwarded to `AiImagePanel`.                                       |

  **Single-occupancy caveat.** Core's sidebar registry holds a single
  `copilotPanel` (last-write-wins). This panel and `@anvilkit/plugin-ai-copilot`'s
  panel both claim the `copilot` slot — register exactly one per `<Studio>` mount.
  In practice they live in different Studio contexts (the canvas editor is a
  sibling mode that mounts separately from the Puck page editor).

### Mock (`./mock`)

```ts
function createMockAiImageProvider(
  opts?: CreateMockAiImageProviderOptions,
): AiImageProvider;
```

| Field           | Type                                            | Default | Purpose                                          |
| --------------- | ----------------------------------------------- | ------- | ------------------------------------------------ |
| `latencyMs`     | `number`                                        | `0`     | Simulated (abort-aware) provider latency.        |
| `resultAssetId` | `string \| ((request) => string)`               | none    | Deterministic result asset id, or a per-request function. |
| failure options | —                                               | none    | Force transient/terminal failures for exercising error and retry paths. |

## Notes & FAQ

### Security model

The plugin never sees credentials, endpoints, or model identifiers — those belong
to the host's `AiImageProvider`. The provider receives exactly `(request, context,
options)` and returns an `AiImageJobResult`.

### Honour the abort signal

`submit()` and `AiJobClient.run()` thread an `AbortSignal` through to the provider.
Providers should pass `options.signal` to their `fetch` (or equivalent) so cancels,
retry sleeps, and poll loops all stop promptly. Aborting resolves to a `cancelled`
result rather than throwing.

### Konva is only needed for the visual surfaces

The headless `.` entry (factory, job client, post-process, commit) has no Konva
dependency. `konva` + `react-konva` become required only when you import the
`./mask` editor layer or the `./react` panel.

## License

MIT
