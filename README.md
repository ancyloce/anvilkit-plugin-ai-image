# @anvilkit/plugin-ai-image

AI image generation plugin for AnvilKit **Canvas Studio**. Wraps a host-supplied
`AiImageProvider` callback so the editor can issue text-to-image, variation,
inpaint, and background-removal jobs through a single typed contract.

> **Status: scaffold only.** The factory accepts options and registers an empty
> plugin block. The real job pipeline (abort/retry/poll), mock provider, and
> sidebar panel land in subsequent Iteration 1 tasks. See
> `docs/plans/0001-canvas-studio-dev-plan-2026-05-20.md` tasks **I1-5** through
> **I1-9** for the rest of the iteration.

## Install

```sh
pnpm add @anvilkit/plugin-ai-image
```

Peer dependencies: `react`, `react-dom`, `@puckeditor/core`.

## Usage

```ts
import { createAiImagePlugin } from "@anvilkit/plugin-ai-image";
import type { AiImageProvider } from "@anvilkit/plugin-ai-image";

const provider: AiImageProvider = async (request, context, options) => {
	// Call your AI service of choice (Replicate, OpenAI, self-hosted SD, ...).
	// Honour `options?.signal` for cancellation.
	throw new Error("provider not implemented");
};

export const aiImage = createAiImagePlugin({ provider });
```

## Contracts

The four shared types (`AiImageProvider`, `AiLayerContext`, `AiImageJobRequest`,
`AiImageJobResult`) live in `@anvilkit/canvas-core` so that the headless IR and
this plugin agree on the wire shape. This package re-exports them for
ergonomics.

## License

MIT
