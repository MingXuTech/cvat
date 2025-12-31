import { Project, Task, Job } from 'cvat-core-wrapper';
import { TimePeriod } from 'components/analytics-report';

export interface AnalyticsLiteProps {
    resource: Project | Task | Job;
    timePeriod: TimePeriod | null;
}

export type ResourceKind = 'project' | 'task' | 'job';

export function getResourceKind(resource: Project | Task | Job): ResourceKind {
    if (resource instanceof Project) return 'project';
    if (resource instanceof Task) return 'task';
    return 'job';
}


