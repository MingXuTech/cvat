// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { LRUCache } from 'lru-cache';
import {
    CVATCore, MLModel, Job, DimensionType,
} from 'cvat-core-wrapper';
import { PluginEntryPoint, APIWrapperEnterOptions, ComponentBuilder } from 'components/plugins-entrypoint';
import { InitBody, DecodeBody, WorkerAction } from './inference.worker';

interface SAMPlugin {
    name: string;
    description: string;
    cvat: {
        lambda: {
            call: {
                enter: (
                    plugin: SAMPlugin,
                    taskID: number,
                    model: MLModel,
                    args: any,
                ) => Promise<null | APIWrapperEnterOptions>;
                leave: (
                    plugin: SAMPlugin,
                    result: object,
                    taskID: number,
                    model: MLModel,
                    args: any,
                ) => Promise<any>;
            };
        };
        jobs: {
            get: {
                leave: (
                    plugin: SAMPlugin,
                    results: any[],
                    query: { jobID?: number }
                ) => Promise<any>;
            };
        };
    };
    data: {
        initialized: boolean;
        worker: Worker;
        core: CVATCore | null;
        jobs: Record<number, Job>;
        modelID: string;
        modelURL: string;
        embeddings: LRUCache<string, Float32Array>;
        lowResMasks: LRUCache<string, Float32Array>;
        lastClicks: ClickType[];
        prefetch: {
            active: boolean;
            queue: SAMEmbeddingPrefetchRequest[];
            failedAt: Map<string, number>;
            lastFrameKey: string | null;
        };
    };
    callbacks: {
        onStatusChange: ((status: string) => void) | null;
    };
}

interface SAMEmbeddingPrefetchRequest {
    taskID: number;
    model: MLModel;
    jobID: number;
    frame: number;
}

interface ClickType {
    clickType: 0 | 1 | 2 | 3;
    x: number;
    y: number;
}

const SAM_PREFETCH_LOOKAHEAD = 2;
const SAM_PREFETCH_FAILURE_COOLDOWN_MS = 10000;
const SAM_PREFETCH_FLAG = '__sam_prefetch';

function getEmbeddingKey(taskID: number, frame: number): string {
    return `${taskID}_${frame}`;
}

function isPrefetchRequest(args: unknown): boolean {
    return !!(
        args &&
        typeof args === 'object' &&
        (args as Record<string, unknown>)[SAM_PREFETCH_FLAG]
    );
}

function cacheEmbedding(plugin: SAMPlugin, taskID: number, frame: number, result: unknown): boolean {
    const blob = result && typeof result === 'object' ? (result as { blob?: unknown }).blob : null;
    if (typeof blob !== 'string') {
        return false;
    }

    const bin = window.atob(blob);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }

    plugin.data.embeddings.set(getEmbeddingKey(taskID, frame), new Float32Array(bytes.buffer));
    return true;
}

function canPrefetchEmbedding(plugin: SAMPlugin, taskID: number, frame: number): boolean {
    const key = getEmbeddingKey(taskID, frame);
    if (plugin.data.embeddings.has(key)) {
        return false;
    }

    const failedAt = plugin.data.prefetch.failedAt.get(key);
    if (typeof failedAt === 'number') {
        if (Date.now() - failedAt < SAM_PREFETCH_FAILURE_COOLDOWN_MS) {
            return false;
        }

        plugin.data.prefetch.failedAt.delete(key);
    }

    return true;
}

function runNextEmbeddingPrefetch(plugin: SAMPlugin): void {
    if (plugin.data.prefetch.active || !plugin.data.core) {
        return;
    }

    const request = plugin.data.prefetch.queue.shift();
    if (!request) {
        return;
    }

    if (!canPrefetchEmbedding(plugin, request.taskID, request.frame)) {
        runNextEmbeddingPrefetch(plugin);
        return;
    }

    plugin.data.prefetch.active = true;
    const key = getEmbeddingKey(request.taskID, request.frame);

    plugin.data.core.lambda.call(request.taskID, request.model, {
        [SAM_PREFETCH_FLAG]: true,
        frame: request.frame,
        job: request.jobID,
        pos_points: [],
        neg_points: [],
        obj_bbox: [],
    }).catch(() => {
        plugin.data.prefetch.failedAt.set(key, Date.now());
    }).finally(() => {
        plugin.data.prefetch.active = false;
        runNextEmbeddingPrefetch(plugin);
    });
}

function scheduleEmbeddingPrefetch(
    plugin: SAMPlugin,
    taskID: number,
    model: MLModel,
    job: Job,
    frame: number,
    includeCurrent = false,
): void {
    const queue: SAMEmbeddingPrefetchRequest[] = [];
    const firstFrame = includeCurrent ? frame : frame + 1;
    for (let nextFrame = firstFrame; nextFrame <= frame + SAM_PREFETCH_LOOKAHEAD; nextFrame++) {
        if (nextFrame > job.stopFrame) {
            break;
        }

        if (canPrefetchEmbedding(plugin, taskID, nextFrame)) {
            queue.push({
                taskID,
                model,
                jobID: job.id,
                frame: nextFrame,
            });
        }
    }

    plugin.data.prefetch.queue = queue;
    runNextEmbeddingPrefetch(plugin);
}

function scheduleEmbeddingPrefetchForState(plugin: SAMPlugin, state: any): void {
    const annotation = state?.annotation;
    const frameData = annotation?.player?.frame;
    const job = annotation?.job?.instance;
    const frame = frameData?.number;
    const model = state?.models?.interactors?.find((_model: MLModel) => _model.id === plugin.data.modelID);

    if (
        !model ||
        frameData?.data?.deleted ||
        typeof frame !== 'number' ||
        !job ||
        typeof job.id !== 'number' ||
        typeof job.taskId !== 'number' ||
        job.dimension !== DimensionType.DIMENSION_2D
    ) {
        plugin.data.prefetch.lastFrameKey = null;
        return;
    }

    const frameKey = `${job.id}_${job.taskId}_${frame}`;
    if (plugin.data.prefetch.lastFrameKey === frameKey) {
        return;
    }

    plugin.data.prefetch.lastFrameKey = frameKey;
    plugin.data.jobs = {
        [job.id]: job,
    };
    scheduleEmbeddingPrefetch(plugin, job.taskId, model, job, frame, true);
}

function toMatImage(input: number[], width: number, height: number): number[][] {
    const image = Array(height).fill(0);
    for (let i = 0; i < image.length; i++) {
        image[i] = Array(width).fill(0);
    }

    for (let i = 0; i < input.length; i++) {
        const row = Math.floor(i / width);
        const col = i % width;
        image[row][col] = input[i] > 0 ? 255 : 0;
    }

    return image;
}

function onnxToImage(input: any, width: number, height: number): number[][] {
    return toMatImage(input, width, height);
}

function getModelScale(w: number, h: number): number {
    // Input images to SAM must be resized so the longest side is 1024
    const LONG_SIDE_LENGTH = 1024;
    const scale = LONG_SIDE_LENGTH / Math.max(h, w);
    return scale;
}

function modelData({
    clicks, imageEmbeddings, modelScale, lowResMask,
}: {
    clicks: ClickType[];
    imageEmbeddings: Float32Array;
    modelScale: { height: number; width: number; scale: number };
    lowResMask: Float32Array | null;
}): DecodeBody {
    const pointCoords = new Float32Array(2 * clicks.length);
    const pointLabels = new Float32Array(clicks.length);

    // Scale and add clicks
    for (let i = 0; i < clicks.length; i++) {
        pointCoords[2 * i] = clicks[i].x * modelScale.scale;
        pointCoords[2 * i + 1] = clicks[i].y * modelScale.scale;
        pointLabels[i] = clicks[i].clickType;
    }

    return {
        imageEmbeddings,
        pointCoords,
        pointLabels,
        width: modelScale.width,
        height: modelScale.height,
        maskInput: lowResMask ?? null,
    };
}

const samPlugin: SAMPlugin = {
    name: 'Segment Anything',
    description: 'Handles non-default SAM serverless function output',
    cvat: {
        jobs: {
            get: {
                async leave(
                    plugin: SAMPlugin,
                    results: any[],
                    query: { jobID?: number; },
                ): Promise<any> {
                    if (typeof query.jobID === 'number') {
                        [plugin.data.jobs[query.jobID]] = results;
                    }
                    return results;
                },
            },
        },
        lambda: {
            call: {
                async enter(
                    plugin: SAMPlugin,
                    taskID: number,
                    model: MLModel,
                    { frame }: { frame: number; },
                ): Promise<null | APIWrapperEnterOptions> {
                    return new Promise((resolve, reject) => {
                        function resolvePromise(): void {
                            const key = getEmbeddingKey(taskID, frame);
                            if (plugin.data.embeddings.has(key)) {
                                resolve({ preventMethodCall: true });
                            } else {
                                resolve(null);
                            }
                        }

                        if (model.id === plugin.data.modelID) {
                            if (!plugin.data.initialized) {
                                samPlugin.data.worker.postMessage({
                                    action: WorkerAction.INIT,
                                    payload: {
                                        decoderURL: samPlugin.data.modelURL,
                                    } as InitBody,
                                });

                                samPlugin.data.worker.onmessage = (e: MessageEvent) => {
                                    if (e.data.action !== WorkerAction.INIT) {
                                        reject(new Error(
                                            `Caught unexpected action response from worker: ${e.data.action}`,
                                        ));
                                    }

                                    if (!e.data.error) {
                                        samPlugin.data.initialized = true;
                                        resolvePromise();
                                    } else {
                                        reject(new Error(`SAM worker was not initialized. ${e.data.error}`));
                                    }
                                };
                            } else {
                                resolvePromise();
                            }
                        } else {
                            resolve(null);
                        }
                    });
                },

                async leave(
                    plugin: SAMPlugin,
                    result: unknown,
                    taskID: number,
                    model: MLModel,
                    args: {
                        frame: number;
                        pos_points: number[][];
                        neg_points: number[][];
                        obj_bbox: number[][];
                        __sam_prefetch?: boolean;
                    },
                ): Promise<{
                        mask: number[][];
                        bounds: [number, number, number, number];
                    } | unknown> {
                    return new Promise((resolve, reject) => {
                        const {
                            frame,
                            pos_points: posPoints,
                            neg_points: negPoints,
                            obj_bbox: objBbox,
                        } = args;

                        if (model.id !== plugin.data.modelID) {
                            resolve(result);
                            return;
                        }

                        const job = Object.values(plugin.data.jobs).find((_job) => (
                            _job.taskId === taskID && frame >= _job.startFrame && frame <= _job.stopFrame
                        )) as Job;

                        if (!job) {
                            throw new Error('Could not find a job corresponding to the request');
                        }

                        plugin.data.jobs = {
                            // we do not need to store old job instances
                            [job.id]: job,
                        };

                        if (isPrefetchRequest(args)) {
                            if (result && plugin.data.core) {
                                cacheEmbedding(plugin, taskID, frame, result);
                            }

                            resolve(result);
                            return;
                        }

                        job.frames.get(frame)
                            .then(({ height: imHeight, width: imWidth }: { height: number; width: number }) => {
                                const key = getEmbeddingKey(taskID, frame);

                                if (result) {
                                    cacheEmbedding(plugin, taskID, frame, result);
                                }

                                const clicks: ClickType[] = [];
                                if (objBbox.length) {
                                    clicks.push({ clickType: 2, x: objBbox[0][0], y: objBbox[0][1] });
                                    clicks.push({ clickType: 3, x: objBbox[1][0], y: objBbox[1][1] });
                                }

                                posPoints.forEach((point) => {
                                    clicks.push({ clickType: 1, x: point[0], y: point[1] });
                                });

                                negPoints.forEach((point) => {
                                    clicks.push({ clickType: 0, x: point[0], y: point[1] });
                                });

                                const isLowResMaskRelevant = JSON
                                    .stringify(clicks.slice(0, -1)) === JSON.stringify(plugin.data.lastClicks);

                                plugin.data.worker.postMessage({
                                    action: WorkerAction.DECODE,
                                    payload: modelData({
                                        imageEmbeddings: plugin.data.embeddings.get(key)!,
                                        lowResMask: isLowResMaskRelevant ?
                                            plugin.data.lowResMasks.get(key) ?? null : null,
                                        modelScale: {
                                            width: imWidth,
                                            height: imHeight,
                                            scale: getModelScale(imWidth, imHeight),
                                        },
                                        clicks,
                                    }),
                                });

                                plugin.data.worker.onmessage = ((e) => {
                                    if (e.data.action !== WorkerAction.DECODE) {
                                        const msg = 'Caught unexpected action response from worker: ' +
                                                `${e.data.action}, while "${WorkerAction.DECODE}" expected`;
                                        reject(new Error(msg));
                                    }

                                    if (!e.data.error) {
                                        const {
                                            mask, lowResMask, xtl, ytl, xbr, ybr,
                                        } = e.data.payload;
                                        const imageData = onnxToImage(mask, xbr - xtl + 1, ybr - ytl + 1);
                                        plugin.data.lowResMasks.set(key, lowResMask);
                                        plugin.data.lastClicks = clicks;
                                        scheduleEmbeddingPrefetch(plugin, taskID, model, job, frame);

                                        resolve({
                                            mask: imageData,
                                            bounds: [xtl, ytl, xbr, ybr],
                                        });
                                    } else {
                                        reject(new Error(`Decoder error. ${e.data.error}`));
                                    }
                                });

                                plugin.data.worker.onerror = ((error) => {
                                    reject(error);
                                });
                            });
                    });
                },
            },
        },
    },
    data: {
        initialized: false,
        core: null,
        worker: new Worker(new URL('./inference.worker', import.meta.url)),
        jobs: {},
        modelID: 'pth-facebookresearch-sam-vit-h',
        modelURL: '/assets/decoder.onnx',
        embeddings: new LRUCache({
            // float32 tensor [256, 64, 64] is 4 MB, max 128 MB
            max: 32,
            updateAgeOnGet: true,
            updateAgeOnHas: true,
        }),
        lowResMasks: new LRUCache({
            // float32 tensor [1, 256, 256] is 0.25 MB, max 8 MB
            max: 32,
            updateAgeOnGet: true,
            updateAgeOnHas: true,
        }),
        lastClicks: [],
        prefetch: {
            active: false,
            queue: [],
            failedAt: new Map(),
            lastFrameKey: null,
        },
    },
    callbacks: {
        onStatusChange: null,
    },
};

const builder: ComponentBuilder = ({ core }) => {
    samPlugin.data.core = core;
    core.plugins.register(samPlugin);

    return {
        name: samPlugin.name,
        globalStateDidUpdate: (state: any) => {
            scheduleEmbeddingPrefetchForState(samPlugin, state);
        },
        destructor: () => {
            samPlugin.data.embeddings.clear();
            samPlugin.data.lowResMasks.clear();
            samPlugin.data.worker.terminate();
            samPlugin.data.lastClicks = [];
            samPlugin.data.prefetch.active = false;
            samPlugin.data.prefetch.queue = [];
            samPlugin.data.prefetch.failedAt.clear();
            samPlugin.data.prefetch.lastFrameKey = null;
            samPlugin.data.jobs = {};
            samPlugin.data.core = null;
            samPlugin.data.initialized = false;
        },
    };
};

function register(): void {
    if (Object.prototype.hasOwnProperty.call(window, 'cvatUI')) {
        (window as any as { cvatUI: { registerComponent: PluginEntryPoint } })
            .cvatUI.registerComponent(builder);
    }
}

window.addEventListener('plugins.ready', register, { once: true });
