// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, { useMemo } from 'react';
import { getCore, Project, Task, Job } from 'cvat-core-wrapper';

import { AnalyticsLiteProps, getResourceKind } from './analytics/types';
import ProjectAnalytics from './analytics/pages/ProjectAnalytics';
import TaskAnalytics from './analytics/pages/TaskAnalytics';
import JobAnalytics from './analytics/pages/JobAnalytics';

function AnalyticsLiteContent(props: AnalyticsLiteProps): JSX.Element {
    const { resource, timePeriod } = props;
    useMemo(() => getCore(), []); // keep parity with previous implementation

    const kind = useMemo(() => getResourceKind(resource), [resource]);
    const debugEnabled = useMemo(() => {
        try {
            return typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).get('analyticsLiteDebug') === '1';
        } catch {
            return false;
        }
    }, []);

    if (resource instanceof Project) {
        return <ProjectAnalytics resource={resource} timePeriod={timePeriod} />;
    }

    if (resource instanceof Task) {
        return <TaskAnalytics resource={resource} timePeriod={timePeriod} debugEnabled={debugEnabled} />;
    }

    if (resource instanceof Job) {
        return <JobAnalytics resource={resource} timePeriod={timePeriod} debugEnabled={debugEnabled} />;
    }

    // Fallback (should not happen)
    if (kind === 'task') return <TaskAnalytics resource={resource as any} timePeriod={timePeriod} debugEnabled={debugEnabled} />;
    return <JobAnalytics resource={resource as any} timePeriod={timePeriod} debugEnabled={debugEnabled} />;
}

export default React.memo(AnalyticsLiteContent);


