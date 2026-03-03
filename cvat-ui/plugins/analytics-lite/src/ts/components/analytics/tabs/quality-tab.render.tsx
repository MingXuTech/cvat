import React from 'react';
import Tag from 'antd/lib/tag';

import { JobRow } from './quality-tab.types';

export function renderRoleTag(role: JobRow['role'] | null): JSX.Element {
    if (role === 'parent') return <Tag color='magenta'>Parent</Tag>;
    if (role === 'consensus') return <Tag color='cyan'>Consensus</Tag>;
    return <Tag>Job</Tag>;
}
