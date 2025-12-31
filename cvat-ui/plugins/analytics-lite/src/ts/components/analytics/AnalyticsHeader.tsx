import React from 'react';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';

import { AnalyticsLiteProps, ResourceKind } from './types';

export default function AnalyticsHeader({
    kind,
    resource,
    timePeriod,
}: AnalyticsLiteProps & { kind: ResourceKind }): JSX.Element {
    return (
        <Card size='small' bordered={false} style={{ background: '#f5f5f5' }}>
            <Descriptions size='small' column={2} bordered>
                <Descriptions.Item label='Resource Type'>{kind.toUpperCase()}</Descriptions.Item>
                <Descriptions.Item label='ID'>{resource.id}</Descriptions.Item>
                {'name' in resource ? (
                    <Descriptions.Item label='Name'>{(resource as any).name}</Descriptions.Item>
                ) : null}
                <Descriptions.Item label='Time period'>
                    {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : 'All Time'}
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );
}


