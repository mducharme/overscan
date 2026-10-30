import { Badge, Button, Input, InputNumber, Segmented, Select, Space, Switch, Typography } from 'antd'
import type { PreviewRenderer } from '../store/studio'
import { formatTime } from '../lib/preview'

export function StudioToolbar({
  fileName,
  unsaved,
  canSave,
  canUndo,
  canRedo,
  canDuplicate,
  canDelete,
  playing,
  currentTime,
  duration,
  bpm,
  renderer,
  playbackRate,
  loopEnabled,
  profileOverlay,
  onSave,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onRewind,
  onTogglePlayback,
  onSeek,
  onStepBack,
  onStepForward,
  onPlaybackRateChange,
  onRendererChange,
  onToggleLoop,
  onToggleProfile,
  onBpmChange,
}: {
  fileName: string
  unsaved: boolean
  canSave: boolean
  canUndo: boolean
  canRedo: boolean
  canDuplicate: boolean
  canDelete: boolean
  playing: boolean
  currentTime: number
  duration: number
  bpm: number | null
  renderer: PreviewRenderer
  playbackRate: number
  loopEnabled: boolean
  profileOverlay: boolean
  onSave(): void
  onDuplicate(): void
  onDelete(): void
  onUndo(): void
  onRedo(): void
  onRewind(): void
  onTogglePlayback(): void
  onSeek(value: string): boolean
  onStepBack(): void
  onStepForward(): void
  onPlaybackRateChange(value: number): void
  onRendererChange(value: PreviewRenderer): void
  onToggleLoop(): void
  onToggleProfile(): void
  onBpmChange(value: number): void
}): JSX.Element {
  return (
    <div className="studioToolbar">
      <Space size="middle" wrap>
        <Typography.Text strong>{fileName}</Typography.Text>
        <Badge status={unsaved ? 'warning' : 'default'} text={unsaved ? 'Unsaved' : 'Saved'} />
        <Button size="small" onClick={onSave} disabled={!canSave}>Save</Button>
        <Button size="small" onClick={onUndo} disabled={!canUndo}>Undo</Button>
        <Button size="small" onClick={onRedo} disabled={!canRedo}>Redo</Button>
        <Button size="small" onClick={onDuplicate} disabled={!canDuplicate}>Duplicate</Button>
        <Button size="small" danger onClick={onDelete} disabled={!canDelete}>Delete</Button>
      </Space>
      <Space size="small" wrap>
        <Button size="small" onClick={onRewind}>Rewind</Button>
        <Button size="small" onClick={onStepBack}>{'['}</Button>
        <Button type="primary" size="small" onClick={onTogglePlayback}>{playing ? 'Pause' : 'Play'}</Button>
        <Button size="small" onClick={onStepForward}>{']'}</Button>
        <Input
          size="small"
          className="toolbarTimeInput"
          defaultValue={formatTime(currentTime)}
          value={formatTime(currentTime)}
          onPressEnter={event => onSeek(event.currentTarget.value)}
        />
        <Typography.Text type="secondary">/ {formatTime(duration)}</Typography.Text>
        <Select<number>
          size="small"
          value={playbackRate}
          onChange={onPlaybackRateChange}
          options={[
            { label: '0.25x', value: 0.25 },
            { label: '0.5x', value: 0.5 },
            { label: '1x', value: 1 },
            { label: '2x', value: 2 },
          ]}
        />
        <Button size="small" type={loopEnabled ? 'primary' : 'default'} onClick={onToggleLoop}>Loop</Button>
        <Space.Compact size="small">
          <InputNumber size="small" value={bpm ?? undefined} onChange={value => value && onBpmChange(value)} />
          <Button size="small" disabled>BPM</Button>
        </Space.Compact>
      </Space>
      <Space size="small" wrap>
        <Segmented<PreviewRenderer>
          size="small"
          value={renderer}
          onChange={value => { onRendererChange(value); }}
          options={[
            { label: 'ASCII', value: 'ascii' },
            { label: 'ANSI', value: 'ansi' },
            { label: '2D', value: '2d' },
            { label: 'GL', value: 'gl' },
          ]}
        />
        <Space size="small">
          <Typography.Text type="secondary">Profile</Typography.Text>
          <Switch size="small" checked={profileOverlay} onChange={onToggleProfile} />
        </Space>
      </Space>
    </div>
  )
}
