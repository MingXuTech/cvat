// @ts-nocheck
import React, { useMemo } from 'react';
import Tabs from 'antd/lib/tabs';
import Space from 'antd/lib/space';
import {
    BarChartOutlined,
    ClockCircleOutlined,
    TeamOutlined,
    ExperimentOutlined,
} from '@ant-design/icons';

import { AnalyticsLiteProps, ResourceKind } from '../types';
import AnalyticsHeader from '../AnalyticsHeader';
import QualityTab from '../tabs/QualityTab';
import ActivityTab from '../tabs/ActivityTab';
import ConsensusTab from '../tabs/ConsensusTab';
import HoneypotsTab from '../tabs/HoneypotsTab';

export default function TaskJobAnalytics(
    props: AnalyticsLiteProps & { kind: ResourceKind; debugEnabled: boolean },
): JSX.Element {
    const { kind, resource, timePeriod, debugEnabled } = props;

    const items = useMemo(() => ([
        {
            key: 'quality',
            label: (
                <Space>
                    <BarChartOutlined />
                    Quality
                </Space>
            ),
            children: <QualityTab resource={resource} kind={kind} timePeriod={timePeriod} debugEnabled={debugEnabled} />,
        },
        {
            key: 'events',
            label: (
                <Space>
                    <ClockCircleOutlined />
                    Activity
                </Space>
            ),
            children: <ActivityTab resource={resource} kind={kind} timePeriod={timePeriod} debugEnabled={debugEnabled} />,
        },
        {
            key: 'consensus',
            label: (
                <Space>
                    <TeamOutlined />
                    Consensus
                </Space>
            ),
            children: <ConsensusTab resource={resource} kind={kind} timePeriod={timePeriod} debugEnabled={debugEnabled} />,
        },
        {
            key: 'honeypots',
            label: (
                <Space>
                    <ExperimentOutlined />
                    Honeypots
                </Space>
            ),
            children: <HoneypotsTab resource={resource} kind={kind} timePeriod={timePeriod} debugEnabled={debugEnabled} />,
        },
    ]), [debugEnabled, kind, resource, timePeriod]);

    return (
        <div style={{
            padding: '0 12px 24px',
            boxSizing: 'border-box',
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
        }}
        >
            <AnalyticsHeader kind={kind} resource={resource} timePeriod={timePeriod} />
            <Tabs items={items} type='card' />
        </div>
    );
}


