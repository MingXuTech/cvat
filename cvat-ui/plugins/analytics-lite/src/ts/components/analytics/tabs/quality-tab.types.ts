import { Job, JobType } from 'cvat-core-wrapper';

export type JobRow = {
    key: string;
    jobId: number;
    parentJobId: number | null;
    role: 'parent' | 'consensus' | 'single';
    depth: number;
    jobType: JobType | null;
    job: Job | null;
    report: any | null;
};

export type OverlayShape = {
    kind: 'rect' | 'poly' | 'line' | 'point' | 'ellipse';
    points: number[];
};

export type ConflictAnnotationId = {
    jobId: number;
    objId: number;
};

export type GalleryMode = 'tp' | 'fp' | 'fn' | 'ds_pos' | 'ds_neg' | 'ds_all' | 'gt_pos' | 'gt_neg' | 'gt_all';

export type GalleryItem = {
    key: string;
    jobId: number;
    frame: number;
    tags: string[];
    severity: 'error' | 'warning' | null;
    preview: string | null;
    dsLink: string | null;
    gtLink: string | null;
    role: 'ds' | 'gt';
    overlayMode: 'conflict' | 'all';
    dsJobId: number | null;
    gtJobId: number | null;
    dsFrame: number | null;
    gtFrame: number | null;
    dsAnnotationIds: number[];
    gtAnnotationIds: number[];
};

export type FrameGalleryState = {
    title: string;
    items: GalleryItem[];
    loading: boolean;
    error: string | null;
};

export type TilePreview = {
    nonce: number;
    src: string | null;
    title: string;
    tags: string[];
    severity: 'error' | 'warning' | null;
    dsLink: string | null;
    gtLink: string | null;
    dsJobId: number | null;
    gtJobId: number | null;
    dsFrame: number | null;
    gtFrame: number | null;
    dsAnnotationIds: number[];
    gtAnnotationIds: number[];
    overlayMode: 'conflict' | 'all';
};

export type TileOverlayState = {
    loading: boolean;
    dsShapes: OverlayShape[];
    gtShapes: OverlayShape[];
    error: string | null;
};

export type JobTotals = {
    dsObjectCount: number | null;
    gtObjectCount: number | null;
    dsObjectCountPending: number;
    dsObjectCountFailed: number;
    gtObjectCountPending: number;
    gtObjectCountFailed: number;
    missingReports: number;
    jobsCount: number;
    dsPositiveImages: number;
    dsPositivePending: number;
    dsPositiveFailed: number;
    gtPositiveImages: number;
    gtPositivePending: number;
    gtPositiveFailed: number;
    dsTotalImages: number | null;
    gtValidationImages: number | null;
    dsNegativeImages: number | null;
    gtNegativeImages: number | null;
};
