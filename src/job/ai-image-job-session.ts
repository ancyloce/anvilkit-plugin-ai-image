import type {
	AiImageJobError,
	AiImageJobProgress,
	AiImageJobRequest,
	AiImageJobResult,
	AiLayerContext,
} from "../types/index.js";

export type AiImageJobSessionStatus =
	| "pending"
	| "complete"
	| "error"
	| "cancelled"
	| "interrupted"
	| "offline"
	| "permission-denied";

/** Serializable recovery record, keyed by the host document id. */
export interface AiImageJobSession {
	readonly version: 1;
	readonly attemptId: string;
	readonly documentId: string;
	readonly taskKind: AiImageJobRequest["kind"];
	readonly request: AiImageJobRequest;
	readonly inputsRedacted: boolean;
	readonly context: AiLayerContext;
	readonly originalAssetId: string | null;
	readonly status: AiImageJobSessionStatus;
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly retryCount: number;
	readonly requiresNetwork: boolean;
	readonly progress?: AiImageJobProgress;
	readonly result?: Extract<AiImageJobResult, { status: "complete" }>;
	readonly error?: AiImageJobError;
}

export interface AiImageJobSessionPersistence {
	load(documentId: string): AiImageJobSession | null;
	save(session: AiImageJobSession): void;
	remove(documentId: string): void;
}

export interface AiImageJobSessionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface BeginAiImageJobSessionOptions {
	readonly documentId: string;
	readonly request: AiImageJobRequest;
	readonly context: AiLayerContext;
	readonly controller: AbortController;
	readonly requiresNetwork?: boolean;
}

export interface AiImageJobSessionCoordinator {
	begin(options: BeginAiImageJobSessionOptions): AiImageJobSession;
	progress(documentId: string, progress: AiImageJobProgress): void;
	settle(documentId: string, result: AiImageJobResult): void;
	fail(documentId: string, error: AiImageJobError): void;
	/** Idempotent: a live controller is aborted at most once. */
	cancel(documentId: string): void;
	setOnline(documentId: string, online: boolean): void;
	setPermission(documentId: string, granted: boolean): void;
	clear(documentId: string): void;
	recover(documentId: string): AiImageJobSession | null;
	get(documentId: string): AiImageJobSession | null;
	subscribe(documentId: string, listener: () => void): () => void;
}

export function createMemoryAiImageJobSessionPersistence(): AiImageJobSessionPersistence {
	const sessions = new Map<string, AiImageJobSession>();
	return {
		load: (documentId) => sessions.get(documentId) ?? null,
		save: (session) => sessions.set(session.documentId, session),
		remove: (documentId) => sessions.delete(documentId),
	};
}

const SESSION_STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"complete",
	"error",
	"cancelled",
	"interrupted",
	"offline",
	"permission-denied",
]);

function isSession(
	value: unknown,
	documentId: string,
): value is AiImageJobSession {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<AiImageJobSession>;
	return (
		candidate.version === 1 &&
		candidate.documentId === documentId &&
		typeof candidate.attemptId === "string" &&
		typeof candidate.taskKind === "string" &&
		typeof candidate.inputsRedacted === "boolean" &&
		typeof candidate.request === "object" &&
		candidate.request !== null &&
		typeof candidate.context === "object" &&
		candidate.context !== null &&
		typeof candidate.status === "string" &&
		SESSION_STATUSES.has(candidate.status) &&
		typeof candidate.startedAt === "number" &&
		typeof candidate.updatedAt === "number" &&
		typeof candidate.retryCount === "number" &&
		typeof candidate.requiresNetwork === "boolean"
	);
}

export interface CreateStorageAiImageJobSessionPersistenceOptions {
	readonly storage: AiImageJobSessionStorage;
	readonly namespace?: string;
}

/** Remove raw prompt text while preserving the task shape needed for recovery. */
export function redactAiImageJobRequest(
	request: AiImageJobRequest,
): AiImageJobRequest {
	if (!("prompt" in request) && !("negativePrompt" in request)) return request;
	return {
		...request,
		...("prompt" in request ? { prompt: "" } : {}),
		...("negativePrompt" in request ? { negativePrompt: "" } : {}),
	} as AiImageJobRequest;
}

function persistedSession(session: AiImageJobSession): AiImageJobSession {
	const result = session.result;
	const metadata = result?.metadata;
	return {
		...session,
		request: redactAiImageJobRequest(session.request),
		inputsRedacted: true,
		...(session.progress
			? { progress: { ...session.progress, message: undefined } }
			: {}),
		...(session.error
			? {
					error: {
						...session.error,
						message: "AI image job requires attention.",
					},
				}
			: {}),
		...(result && metadata?.providerAssetId
			? {
					result: {
						...result,
						metadata: { ...metadata, providerAssetId: undefined },
					},
				}
			: {}),
	};
}

/** Host-injected storage adapter; no browser global is read by the package. */
export function createStorageAiImageJobSessionPersistence(
	options: CreateStorageAiImageJobSessionPersistenceOptions,
): AiImageJobSessionPersistence {
	const prefix = `${options.namespace ?? "anvilkit-ai-image"}:`;
	const keyFor = (documentId: string): string =>
		`${prefix}${encodeURIComponent(documentId)}`;
	return {
		load(documentId) {
			const key = keyFor(documentId);
			const raw = options.storage.getItem(key);
			if (!raw) return null;
			try {
				const parsed: unknown = JSON.parse(raw);
				if (isSession(parsed, documentId)) return parsed;
			} catch {
				// Corrupt or stale recovery state is removed below and never trusted.
			}
			options.storage.removeItem(key);
			return null;
		},
		save(session) {
			options.storage.setItem(
				keyFor(session.documentId),
				JSON.stringify(persistedSession(session)),
			);
		},
		remove(documentId) {
			options.storage.removeItem(keyFor(documentId));
		},
	};
}

export interface CreateAiImageJobSessionCoordinatorOptions {
	readonly persistence?: AiImageJobSessionPersistence;
	readonly now?: () => number;
	/** Raw prompts remain in memory for at most this long. Defaults to the host lifetime. */
	readonly promptRetentionMs?: number;
}

/**
 * Document-scoped job coordinator. Live abort handles remain in memory while
 * the panel is closed; serializable state survives reload without ever being
 * confused with another document's job.
 */
export function createAiImageJobSessionCoordinator(
	options: CreateAiImageJobSessionCoordinatorOptions = {},
): AiImageJobSessionCoordinator {
	const persistence =
		options.persistence ?? createMemoryAiImageJobSessionPersistence();
	const now = options.now ?? Date.now;
	const promptRetentionMs =
		options.promptRetentionMs ?? Number.POSITIVE_INFINITY;
	const sessions = new Map<string, AiImageJobSession>();
	const controllers = new Map<string, AbortController>();
	const listeners = new Map<string, Set<() => void>>();
	const recovered = new Set<string>();
	const retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let attemptCounter = 0;

	const emit = (documentId: string): void => {
		for (const listener of listeners.get(documentId) ?? []) listener();
	};
	const write = (session: AiImageJobSession): void => {
		sessions.set(session.documentId, session);
		persistence.save(session);
		emit(session.documentId);
	};
	const patch = (
		documentId: string,
		update: Partial<AiImageJobSession>,
	): AiImageJobSession | null => {
		const current = sessions.get(documentId);
		if (!current) return null;
		const next = { ...current, ...update, updatedAt: now() };
		write(next);
		return next;
	};

	const coordinator: AiImageJobSessionCoordinator = {
		begin(beginOptions) {
			const previous = coordinator.recover(beginOptions.documentId);
			controllers.get(beginOptions.documentId)?.abort();
			attemptCounter += 1;
			const timestamp = now();
			const session: AiImageJobSession = {
				version: 1,
				attemptId: `${beginOptions.documentId}:${timestamp}:${attemptCounter}`,
				documentId: beginOptions.documentId,
				taskKind: beginOptions.request.kind,
				request: beginOptions.request,
				inputsRedacted: false,
				context: beginOptions.context,
				originalAssetId:
					"sourceAssetId" in beginOptions.request
						? beginOptions.request.sourceAssetId
						: null,
				status: "pending",
				startedAt: timestamp,
				updatedAt: timestamp,
				retryCount:
					previous && previous.status !== "complete"
						? previous.retryCount + 1
						: 0,
				requiresNetwork: beginOptions.requiresNetwork ?? true,
			};
			controllers.set(beginOptions.documentId, beginOptions.controller);
			const priorTimer = retentionTimers.get(beginOptions.documentId);
			if (priorTimer) clearTimeout(priorTimer);
			if (promptRetentionMs <= 0) {
				const redacted = {
					...session,
					request: redactAiImageJobRequest(session.request),
					inputsRedacted: true,
				};
				write(redacted);
				return redacted;
			}
			write(session);
			if (Number.isFinite(promptRetentionMs)) {
				const attemptId = session.attemptId;
				retentionTimers.set(
					beginOptions.documentId,
					setTimeout(() => {
						const current = sessions.get(beginOptions.documentId);
						if (!current || current.attemptId !== attemptId) return;
						retentionTimers.delete(beginOptions.documentId);
						patch(beginOptions.documentId, {
							request: redactAiImageJobRequest(current.request),
							inputsRedacted: true,
						});
					}, promptRetentionMs),
				);
			}
			return session;
		},
		progress(documentId, progress) {
			const current = sessions.get(documentId);
			if (current?.status !== "pending") return;
			patch(documentId, { progress });
		},
		settle(documentId, result) {
			const current = sessions.get(documentId);
			if (current?.status !== "pending") return;
			controllers.delete(documentId);
			if (result.status === "complete") {
				patch(documentId, {
					status: "complete",
					result,
					progress: result.progress,
					error: undefined,
				});
				return;
			}
			if (result.status === "error") {
				patch(documentId, { status: "error", error: result.error });
				return;
			}
			if (result.status === "cancelled") {
				patch(documentId, { status: "cancelled" });
			}
		},
		fail(documentId, error) {
			const current = sessions.get(documentId);
			if (current?.status !== "pending") return;
			controllers.delete(documentId);
			patch(documentId, { status: "error", error });
		},
		cancel(documentId) {
			const current = sessions.get(documentId);
			if (current?.status !== "pending") return;
			const controller = controllers.get(documentId);
			controllers.delete(documentId);
			controller?.abort();
			patch(documentId, { status: "cancelled" });
		},
		setOnline(documentId, online) {
			const current = coordinator.recover(documentId);
			if (online || current?.status !== "pending" || !current.requiresNetwork) {
				return;
			}
			controllers.get(documentId)?.abort();
			controllers.delete(documentId);
			patch(documentId, {
				status: "offline",
				error: {
					code: "OFFLINE",
					message: "Connection lost. Reconnect, then retry this task.",
					category: "network",
					retryable: true,
				},
			});
		},
		setPermission(documentId, granted) {
			const current = coordinator.recover(documentId);
			if (granted || !current) return;
			if (current.status === "pending") {
				controllers.get(documentId)?.abort();
				controllers.delete(documentId);
			}
			if (
				current.status === "pending" ||
				current.status === "complete" ||
				current.status === "interrupted" ||
				current.status === "offline"
			) {
				patch(documentId, {
					status: "permission-denied",
					result: undefined,
					progress: undefined,
					error: {
						code: "PERMISSION_REVOKED",
						message:
							"AI image permission changed. Ask an owner for access before retrying.",
						category: "authorization",
						retryable: true,
					},
				});
			}
		},
		clear(documentId) {
			controllers.get(documentId)?.abort();
			controllers.delete(documentId);
			const timer = retentionTimers.get(documentId);
			if (timer) clearTimeout(timer);
			retentionTimers.delete(documentId);
			sessions.delete(documentId);
			persistence.remove(documentId);
			emit(documentId);
		},
		recover(documentId) {
			if (sessions.has(documentId)) return sessions.get(documentId) ?? null;
			if (recovered.has(documentId)) return null;
			recovered.add(documentId);
			const stored = persistence.load(documentId);
			if (!stored) return null;
			const next =
				stored.status === "pending"
					? {
							...stored,
							status: "interrupted" as const,
							updatedAt: now(),
							error: {
								code: "RELOAD_INTERRUPTED",
								message:
									"This task was interrupted by a reload. Retry to start a new attempt.",
								category: "network" as const,
								retryable: true,
							},
						}
					: stored;
			write(next);
			return next;
		},
		get(documentId) {
			return coordinator.recover(documentId);
		},
		subscribe(documentId, listener) {
			const documentListeners = listeners.get(documentId) ?? new Set();
			documentListeners.add(listener);
			listeners.set(documentId, documentListeners);
			return () => {
				documentListeners.delete(listener);
				if (documentListeners.size === 0) listeners.delete(documentId);
			};
		},
	};
	return coordinator;
}
