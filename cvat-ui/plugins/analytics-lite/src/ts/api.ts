// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { getCore } from 'cvat-core-wrapper';

const core = getCore();

export function isCvatError(error: unknown): error is { code: number; message?: string } {
    return !!error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'number';
}

export async function fetchQualityReportData(reportId: number): Promise<any> {
    // /api/quality/reports/{id}/data returns JSON string (application/json)
    const response = await core.server.request(`/api/quality/reports/${reportId}/data`, {
        method: 'GET',
    });

    // core.server.request returns AxiosResponse.data in most cases, but keep it defensive
    if (typeof response === 'string') {
        return JSON.parse(response);
    }
    return response;
}


