import React from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Empty from 'antd/lib/empty';
import Modal from 'antd/lib/modal';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Tag from 'antd/lib/tag';
import Text from 'antd/lib/typography/Text';

import { renderOverlayShape } from './quality-tab.overlay';
import { FrameGalleryState, GalleryItem, TileOverlayState, TilePreview } from './quality-tab.types';

const FRAME_GALLERY_MODAL_Z_INDEX = 1000;
const FRAME_PREVIEW_MODAL_Z_INDEX = FRAME_GALLERY_MODAL_Z_INDEX + 100;

export type FrameGalleryModalProps = {
    frameGallery: FrameGalleryState | null;
    onClose: () => void;
    onSelect: (item: GalleryItem) => void;
};

export function FrameGalleryModal(props: FrameGalleryModalProps): JSX.Element {
    const { frameGallery, onClose, onSelect } = props;

    return (
        <Modal
            open={!!frameGallery}
            onCancel={onClose}
            footer={null}
            width={1000}
            zIndex={FRAME_GALLERY_MODAL_Z_INDEX}
            title={frameGallery?.title || 'Frames'}
        >
            {frameGallery ? (
                <div>
                    {frameGallery.loading ? (
                        <div style={{ textAlign: 'center', padding: 24 }}>
                            <Spin />
                        </div>
                    ) : frameGallery.error ? (
                        <Alert type='error' showIcon message='无法加载图片列表' description={frameGallery.error} />
                    ) : frameGallery.items.length ? (
                        <div
                            style={{
                                display: 'grid',
                                gap: 12,
                                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                            }}
                        >
                            {frameGallery.items.map((m) => {
                                const severity = m.severity;
                                return (
                                    <div
                                        key={m.key}
                                        style={{
                                            border: severity === 'error' ? '2px solid #ff4d4f' :
                                                (severity === 'warning' ? '2px solid #faad14' : '1px solid #d9d9d9'),
                                            borderRadius: 8,
                                            overflow: 'hidden',
                                            background: '#111',
                                            position: 'relative',
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => onSelect(m)}
                                    >
                                        <div style={{ aspectRatio: '16/9', background: '#000' }}>
                                            {m.preview ? (
                                                <img
                                                    src={m.preview}
                                                    alt={`frame ${m.frame}`}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                />
                                            ) : (
                                                <div style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: '#999',
                                                    fontSize: 12,
                                                }}
                                                >
                                                    No preview
                                                </div>
                                            )}
                                        </div>
                                        <div style={{
                                            position: 'absolute',
                                            left: 8,
                                            top: 8,
                                            background: 'rgba(0,0,0,0.65)',
                                            color: '#fff',
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                            fontSize: 12,
                                        }}
                                        >
                                            #{m.frame}
                                        </div>
                                        {(typeof m.errorCount === 'number' || typeof m.warningCount === 'number') ? (
                                            <div style={{
                                                position: 'absolute',
                                                right: 8,
                                                top: 8,
                                                display: 'flex',
                                                gap: 4,
                                            }}
                                            >
                                                <span
                                                    style={{
                                                        background: '#ff4d4f',
                                                        color: '#fff',
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    E {m.errorCount ?? 0}
                                                </span>
                                                <span
                                                    style={{
                                                        background: '#faad14',
                                                        color: '#111',
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    W {m.warningCount ?? 0}
                                                </span>
                                            </div>
                                        ) : null}
                                        <div style={{
                                            position: 'absolute',
                                            left: 8,
                                            bottom: 8,
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 4,
                                        }}
                                        >
                                            {(m.tags || []).slice(0, 3).map((t) => (
                                                <span
                                                    key={t}
                                                    style={{
                                                        background: t === 'error' ? '#ff4d4f' :
                                                            (t === 'warning' ? '#faad14' : 'rgba(0,0,0,0.65)'),
                                                        color: '#fff',
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                            {(m.tags || []).length > 3 ? (
                                                <span
                                                    style={{
                                                        background: 'rgba(0,0,0,0.65)',
                                                        color: '#fff',
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    +{(m.tags || []).length - 3}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无图片' />
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

export type FramePreviewModalProps = {
    tilePreview: TilePreview | null;
    tileOverlay: TileOverlayState;
    tileImageSize: { w: number; h: number } | null;
    onClose: () => void;
    onImageSize: (size: { w: number; h: number } | null) => void;
};

export function FramePreviewModal(props: FramePreviewModalProps): JSX.Element {
    const {
        tilePreview,
        tileOverlay,
        tileImageSize,
        onClose,
        onImageSize,
    } = props;

    const dsOverlayStroke = tilePreview?.severity === 'error' ? '#a8071a' : '#d46b08';
    const dsOverlayFill = tilePreview?.severity === 'error' ? 'rgba(168,7,26,0.18)' : 'rgba(212,107,8,0.16)';
    const gtOverlayStroke = '#0050b3';
    const gtOverlayFill = 'rgba(0,80,179,0.14)';
    const gtOverlayDash = '4 2';
    const overlayStrokeWidth = 3;
    const canShowGtOverlay = !!(
        tilePreview &&
        tilePreview.gtFrame !== null &&
        (tilePreview.dsFrame === null || tilePreview.dsFrame === tilePreview.gtFrame)
    );
    const gtFrameMismatch = !!(
        tilePreview &&
        tilePreview.gtAnnotationIds?.length &&
        tilePreview.dsFrame !== null &&
        tilePreview.gtFrame !== null &&
        tilePreview.dsFrame !== tilePreview.gtFrame
    );
    const hasOverlayAnnotations = !!(
        tilePreview &&
        ((tilePreview.dsAnnotationIds && tilePreview.dsAnnotationIds.length) ||
            (tilePreview.gtAnnotationIds && tilePreview.gtAnnotationIds.length))
    );
    const isConflictOverlay = tilePreview?.overlayMode === 'conflict';
    const hasOverlayShapes = (tileOverlay.dsShapes.length + tileOverlay.gtShapes.length) > 0;

    return (
        <Modal
            open={!!tilePreview}
            onCancel={onClose}
            footer={null}
            width={900}
            zIndex={FRAME_PREVIEW_MODAL_Z_INDEX}
            title={tilePreview?.title || 'Frame'}
        >
            {tilePreview ? (
                <div>
                    <div style={{ position: 'relative' }}>
                        {tilePreview.src ? (
                            <img
                                key={tilePreview.nonce}
                                src={tilePreview.src}
                                alt={tilePreview.title}
                                style={{
                                    width: '100%',
                                    borderRadius: 8,
                                    border: tilePreview.severity === 'error' ? '3px solid #ff4d4f' :
                                        (tilePreview.severity === 'warning' ? '3px solid #faad14' : '1px solid #d9d9d9'),
                                }}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    if (img?.naturalWidth && img?.naturalHeight) {
                                        onImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                                    }
                                }}
                            />
                        ) : (
                            <div style={{
                                height: 360,
                                borderRadius: 8,
                                border: '1px solid #d9d9d9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#999',
                            }}
                            >
                                No preview
                            </div>
                        )}
                        {tilePreview.src && tileImageSize ? (
                            <svg
                                viewBox={`0 0 ${tileImageSize.w} ${tileImageSize.h}`}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: 'none',
                                }}
                            >
                                {tileOverlay.dsShapes.map((shape, idx) => (
                                    renderOverlayShape(
                                        shape,
                                        `ds-${idx}`,
                                        dsOverlayStroke,
                                        dsOverlayFill,
                                        undefined,
                                        overlayStrokeWidth,
                                    )
                                ))}
                                {canShowGtOverlay ? tileOverlay.gtShapes.map((shape, idx) => (
                                    renderOverlayShape(
                                        shape,
                                        `gt-${idx}`,
                                        gtOverlayStroke,
                                        gtOverlayFill,
                                        gtOverlayDash,
                                        overlayStrokeWidth,
                                    )
                                )) : null}
                            </svg>
                        ) : null}
                        {tileOverlay.loading ? (
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(0,0,0,0.35)',
                                color: '#fff',
                            }}
                            >
                                <Spin />
                            </div>
                        ) : null}
                        {!tileOverlay.loading && isConflictOverlay && hasOverlayAnnotations && !hasOverlayShapes && !gtFrameMismatch ? (
                            <div style={{
                                position: 'absolute',
                                left: 12,
                                bottom: 12,
                                background: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 12,
                            }}
                            >
                                未匹配到可高亮的标注
                            </div>
                        ) : null}
                        <div style={{
                            position: 'absolute',
                            left: 12,
                            top: 12,
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                        }}
                        >
                            {tilePreview.tags.map((t) => (
                                <Tag key={t} color={t === 'error' ? 'red' : (t === 'warning' ? 'orange' : 'default')}>
                                    {t}
                                </Tag>
                            ))}
                        </div>
                        {(tilePreview.dsAnnotationIds?.length || tilePreview.gtAnnotationIds?.length) ? (
                            <div style={{
                                position: 'absolute',
                                right: 12,
                                top: 12,
                                display: 'flex',
                                gap: 6,
                                flexWrap: 'wrap',
                            }}
                            >
                                {tilePreview.dsAnnotationIds?.length ? (
                                    <span style={{
                                        background: 'rgba(0,0,0,0.45)',
                                        border: `1.5px solid ${dsOverlayStroke}`,
                                        color: '#fff',
                                        padding: '2px 8px',
                                        borderRadius: 12,
                                        fontSize: 12,
                                        letterSpacing: 0.3,
                                    }}
                                    >
                                        DS
                                    </span>
                                ) : null}
                                {tilePreview.gtAnnotationIds?.length ? (
                                    <span style={{
                                        background: 'rgba(0,0,0,0.45)',
                                        border: `1.5px dashed ${gtOverlayStroke}`,
                                        color: '#fff',
                                        padding: '2px 8px',
                                        borderRadius: 12,
                                        fontSize: 12,
                                        letterSpacing: 0.3,
                                    }}
                                    >
                                        GT
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <Space>
                            {tilePreview.dsLink ? <Button type='primary' href={tilePreview.dsLink} target='_blank'>打开 DS</Button> : null}
                            {tilePreview.gtLink ? <Button href={tilePreview.gtLink} target='_blank'>打开 GT</Button> : null}
                        </Space>
                        {gtFrameMismatch ? (
                            <Text type='secondary' style={{ marginLeft: 12 }}>
                                GT frame 与 DS frame 不一致，GT 标注未叠加。请点击“打开 GT”查看。
                            </Text>
                        ) : null}
                        {tileOverlay.error ? (
                            <Text type='danger' style={{ marginLeft: 12 }}>{tileOverlay.error}</Text>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
