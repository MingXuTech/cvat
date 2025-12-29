// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { ComponentBuilder, PluginEntryPoint } from 'components/plugins-entrypoint';
import AnalyticsLiteContent from './components/AnalyticsLiteContent';

const builder: ComponentBuilder = ({ actionCreators, dispatch }) => {
    // Override the default paid placeholder content
    dispatch(actionCreators.updateUIComponent('analyticsReportPage.content', AnalyticsLiteContent));

    return {
        name: 'Analytics Lite',
        destructor: () => {
            dispatch(actionCreators.revokeUIComponent('analyticsReportPage.content', AnalyticsLiteContent));
        },
    };
};

function register(): void {
    if (Object.prototype.hasOwnProperty.call(window, 'cvatUI')) {
        // eslint-disable-next-line no-console
        console.info('[analytics-lite] registering plugin');
        (window as any as { cvatUI: { registerComponent: PluginEntryPoint } })
            .cvatUI.registerComponent(builder);
    }
}

// Be robust to load order:
// - In some environments the event may be dispatched before this script is evaluated
// - Some browsers don't propagate document events to window listeners reliably
if (Object.prototype.hasOwnProperty.call(window, 'cvatUI')) {
    register();
} else {
    window.document.addEventListener('plugins.ready', register, { once: true } as AddEventListenerOptions);
}


