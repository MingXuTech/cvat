// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { ComponentBuilder, PluginEntryPoint } from 'components/plugins-entrypoint';
import AnalyticsLiteContent from './components/AnalyticsLiteContent';

const builder: ComponentBuilder = ({ actionCreators }) => {
    // Override the default paid placeholder content
    actionCreators.updateUIComponent('analyticsReportPage.content', AnalyticsLiteContent);

    return {
        name: 'Analytics Lite',
        destructor: () => {
            actionCreators.revokeUIComponent('analyticsReportPage.content', AnalyticsLiteContent);
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


