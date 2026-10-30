import { Button, Card, ColorPicker, Input, InputNumber, Modal, Select, Slider, Space, Switch, Tag, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioClip, Demo, DemoModifier, DemoSection, DemoTransition, RocketInterpolation } from '@overscan/types'
import type { DemoRuntimeSection } from '@overscan/sequencer'
import { NODE_CATALOG } from '../graph/node-catalog'
import type { DocumentAudioSpan, SceneRuntime } from '../lib/runtime'
import { fromHexColor, toHexColor } from '../lib/preview'
import { formatTime } from '../lib/preview'

export function TimelinePanel({
  title,
  demo,
  sections,
  audioTimeline,
  activeSceneAudio,
  activeSectionId,
  currentTime,
  duration,
  onJumpToSection,
  onSeek,
  onAddSection,
  onMoveSection,
  onDuplicateSection,
  onDeleteSection,
  onUpdateSection,
  onUpdateDemoAudio,
  onUpdateDemoLoop,
  demoModifiers,
  onAddDemoModifier,
  onMoveDemoModifier,
  onUpdateDemoModifier,
  onRemoveDemoModifier,
}: {
  title: string
  demo: Demo
  sections: DemoRuntimeSection<SceneRuntime>[]
  audioTimeline: DocumentAudioSpan[]
  activeSceneAudio: AudioClip | null
  activeSectionId: string | null
  currentTime: number
  duration: number
  onJumpToSection(sectionId: string, start: number): void
  onSeek(time: number): void
  onAddSection(): void
  onMoveSection(sectionId: string, targetIndex: number): void
  onDuplicateSection(sectionId: string): void
  onDeleteSection(sectionId: string): void
  onUpdateSection(sectionId: string, updater: (section: DemoSection) => DemoSection): void
  onUpdateDemoAudio(audio: Demo['audio']): void
  onUpdateDemoLoop(loop: boolean): void
  demoModifiers: DemoModifier[]
  onAddDemoModifier(impl: string): void
  onMoveDemoModifier(modifierId: string, direction: -1 | 1): void
  onUpdateDemoModifier(modifierId: string, updater: (entry: DemoModifier) => DemoModifier): void
  onRemoveDemoModifier(modifierId: string): void
}): JSX.Element {
  const [editingTransitionSectionId, setEditingTransitionSectionId] = useState<string | null>(null)
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null)
  const [pendingModifierImpl, setPendingModifierImpl] = useState<string>('crt')
  const [waveforms, setWaveforms] = useState<Record<string, { peaks: number[]; durationSeconds: number }>>({})
  const [zoom, setZoom] = useState(32)
  const resizeRef = useRef<{
    sectionId: string
    startX: number
    initialDuration: number
  } | null>(null)

  function sectionSource(sectionId: string): DemoSection | undefined {
    return demo.sections.find(section => section.id === sectionId)
  }

  const editingSection = useMemo(
    () => editingTransitionSectionId ? sectionSource(editingTransitionSectionId) : undefined,
    [demo.sections, editingTransitionSectionId],
  )

  const transitionTypes: DemoTransition['type'][] = [
    'cut',
    'dissolve',
    'flash',
    'iris',
    'wipe-down',
    'wipe-left',
    'wipe-right',
    'wipe-up',
    'zoom-out',
  ]

  const easingModes: RocketInterpolation[] = [
    'step',
    'linear',
    'smooth',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'elastic',
    'bounce',
    'back',
    'expo-in',
    'expo-out',
  ]

  const modifierOptions = useMemo(
    () => NODE_CATALOG.filter(item => item.type === 'modifier').map(item => ({ label: item.label, value: item.impl })),
    [],
  )

  useEffect(() => {
    const pending = audioTimeline.filter(span => !waveforms[span.sourcePath])
    if (pending.length === 0) return

    const AudioContextCtor = window.AudioContext ?? (window as typeof window & {
      webkitAudioContext?: typeof AudioContext
    }).webkitAudioContext
    if (!AudioContextCtor) return

    let cancelled = false
    const ctx = new AudioContextCtor()

    const load = async (): Promise<void> => {
      for (const span of pending) {
        try {
          const response = await fetch(span.sourceUrl)
          const buffer = await response.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
          const channel = audioBuffer.getChannelData(0)
          const samples = 4096
          const blockSize = Math.max(1, Math.floor(channel.length / samples))
          const peaks = Array.from({ length: samples }, (_, index) => {
            const start = index * blockSize
            const end = Math.min(channel.length, start + blockSize)
            let peak = 0
            for (let cursor = start; cursor < end; cursor += 1) {
              peak = Math.max(peak, Math.abs(channel[cursor] ?? 0))
            }
            return peak
          })
          if (!cancelled) {
            setWaveforms(current => ({
              ...current,
              [span.sourcePath]: {
                peaks,
                durationSeconds: audioBuffer.duration,
              },
            }))
          }
        } catch {
          if (!cancelled) {
            setWaveforms(current => ({
              ...current,
              [span.sourcePath]: {
                peaks: [],
                durationSeconds: span.end - span.start,
              },
            }))
          }
        }
      }
    }

    void load().finally(() => {
      void ctx.close().catch(() => {})
    })

    return () => {
      cancelled = true
      void ctx.close().catch(() => {})
    }
  }, [audioTimeline, waveforms])

  const demoAudio = typeof demo.audio === 'string'
    ? { src: demo.audio, volume: 1 }
    : demo.audio ?? { src: '', volume: 1 }

  const audioClipSegments = useMemo(() => audioTimeline.flatMap(span => {
    const sourceDuration = Math.max(0.01, waveforms[span.sourcePath]?.durationSeconds ?? (span.end - span.start))
    if (span.kind === 'demo' && demo.loop) {
      const segments: { span: DocumentAudioSpan; start: number; end: number; tileIndex: number }[] = []
      for (let start = span.start, tileIndex = 0; start < duration; start += sourceDuration, tileIndex += 1) {
        segments.push({
          span,
          start,
          end: Math.min(duration, start + sourceDuration),
          tileIndex,
        })
      }
      return segments
    }
    return [{
      span,
      start: span.start,
      end: Math.min(duration, span.start + sourceDuration, span.end),
      tileIndex: 0,
    }]
  }), [audioTimeline, demo.loop, duration, waveforms])

  const timelineWidth = Math.max(duration * zoom, 720)

  const rulerStep = useMemo(() => {
    const desiredPx = 96
    const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
    return candidates.find(step => step * zoom >= desiredPx) ?? 60
  }, [zoom])

  const rulerTicks = useMemo(() => {
    const ticks: number[] = []
    for (let value = 0; value <= duration + 0.0001; value += rulerStep) {
      ticks.push(Number(value.toFixed(3)))
    }
    return ticks
  }, [duration, rulerStep])

  useEffect(() => {
    if (!resizeRef.current) return

    const onPointerMove = (event: PointerEvent) => {
      const active = resizeRef.current
      if (!active) return
      const deltaSeconds = (event.clientX - active.startX) / zoom
      const nextDuration = Math.max(0.1, Number((active.initialDuration + deltaSeconds).toFixed(3)))
      onUpdateSection(active.sectionId, current => ({ ...current, duration: nextDuration }))
    }

    const onPointerUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onUpdateSection, zoom])

  function updateTransition(sectionId: string, updater: (transition: DemoTransition) => DemoTransition): void {
    onUpdateSection(sectionId, current => ({
      ...current,
      transition: updater(current.transition ?? { type: 'cut' }),
    }))
  }

  function transitionLabel(section: DemoSection | undefined, runtimeSection: DemoRuntimeSection<SceneRuntime>): string {
    const transition = section?.transition
    if (!transition || transition.type === 'cut') return 'Cut'
    const durationLabel = typeof transition.duration === 'number' ? ` ${transition.duration.toFixed(1)}s` : ''
    return `${transition.type}${durationLabel}`
  }

  return (
    <Card
      className="studioPanel timelinePanel"
      title="Sequence"
      extra={(
        <Space>
          <Typography.Text type="secondary">{formatTime(currentTime)} / {formatTime(duration)}</Typography.Text>
          <Typography.Text type="secondary">{title}</Typography.Text>
          <Space size="small">
            <Typography.Text type="secondary">Zoom</Typography.Text>
            <Slider
              min={16}
              max={160}
              step={4}
              value={zoom}
              onChange={value => { setZoom(Number(value)); }}
              style={{ width: 140 }}
            />
          </Space>
          <Button size="small" onClick={onAddSection}>Add section</Button>
        </Space>
      )}
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <div className="timelineViewport">
          <div
            className="timelineScrub"
            style={{ width: timelineWidth }}
            onClick={event => {
              const rect = (event.currentTarget).getBoundingClientRect()
              const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
              onSeek(duration * Math.max(0, Math.min(1, ratio)))
            }}
          >
            <div className="timelineRuler">
              {rulerTicks.map(tick => (
                <div
                  key={tick}
                  className="timelineRulerTick"
                  style={{ left: `${(tick / Math.max(duration, 0.001)) * 100}%` }}
                >
                  <span>{formatTime(tick)}</span>
                </div>
              ))}
            </div>
            <div className="timelineScrubTrack" />
            <div className="timelineScrubHead" style={{ left: `${(currentTime / Math.max(duration, 0.001)) * 100}%` }} />
          {sections.map(section => {
            const left = (section.start / Math.max(duration, 0.001)) * 100
            const width = ((section.end - section.start) / Math.max(duration, 0.001)) * 100
            const source = sectionSource(section.id)
            return (
              <div
                key={section.id}
                className={`timelineRange ${activeSectionId === section.id ? 'timelineRangeActive' : ''}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }}
                draggable
                onDragStart={() => { setDraggingSectionId(section.id); }}
                onDragEnd={() => { setDraggingSectionId(null); }}
                onDragOver={event => { event.preventDefault(); }}
                onDrop={event => {
                  event.preventDefault()
                  if (!draggingSectionId || draggingSectionId === section.id) return
                  onMoveSection(draggingSectionId, sections.findIndex(entry => entry.id === section.id))
                  setDraggingSectionId(null)
                }}
                onClick={event => {
                  event.stopPropagation()
                  onJumpToSection(section.id, section.start)
                }}
              >
                <button
                  type="button"
                  className="timelineResizeHandle timelineResizeHandleEnd"
                  onPointerDown={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    resizeRef.current = {
                      sectionId: section.id,
                      startX: event.clientX,
                      initialDuration: source?.duration ?? (section.end - section.start),
                    }
                  }}
                  aria-label={`Resize ${section.id}`}
                />
                <div className="timelineRangeContent">
                  <span>{section.id}</span>
                </div>
                <button
                  type="button"
                  className="timelineTransitionChip timelineTransitionChipBelow"
                  onClick={event => {
                    event.stopPropagation()
                    setEditingTransitionSectionId(section.id)
                  }}
                >
                  {transitionLabel(source, section)}
                </button>
              </div>
            )
          })}
            <div className="timelineAudioLane">
            {audioClipSegments.map(({ span, start, end, tileIndex }) => {
              const left = (start / Math.max(duration, 0.001)) * 100
              const width = ((end - start) / Math.max(duration, 0.001)) * 100
              return (
                <div
                  key={`${span.id}:${tileIndex}`}
                  className={`timelineAudioClip timelineAudioClip${span.kind === 'demo' ? 'Demo' : 'Scene'}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                  title={`${span.label} · vol ${span.volume.toFixed(2)}`}
                >
                  <svg
                    className="timelineWaveform"
                    viewBox={`0 0 ${Math.max(1, Math.round((width / 100) * timelineWidth))} 22`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {(() => {
                      const rawPeaks = waveforms[span.sourcePath]?.peaks ?? []
                      const displaySamples = Math.max(16, Math.round((width / 100) * timelineWidth))
                      if (rawPeaks.length === 0) return null
                      const sampleStep = rawPeaks.length / displaySamples
                      return Array.from({ length: displaySamples }, (_, index) => {
                        const start = Math.floor(index * sampleStep)
                        const end = Math.min(rawPeaks.length, Math.ceil((index + 1) * sampleStep))
                        let peak = 0
                        for (let cursor = start; cursor < end; cursor += 1) {
                          peak = Math.max(peak, rawPeaks[cursor] ?? 0)
                        }
                      const height = Math.max(1, peak * 20)
                      const y = (22 - height) / 2
                      return (
                        <rect
                          key={`${span.id}:${index}`}
                          x={index}
                          y={y}
                          width="1"
                          height={height}
                          fill="rgba(255,255,255,0.5)"
                        />
                      )
                      })
                    })()}
                  </svg>
                  <span>{span.label}</span>
                </div>
              )
            })}
            </div>
          </div>
        </div>
        <div className="timelineDemoControls">
          <Typography.Text strong>Demo audio</Typography.Text>
          <Input
            size="small"
            value={demoAudio.src}
            placeholder="soundtrack path"
            onChange={event => { onUpdateDemoAudio(event.target.value ? { ...demoAudio, src: event.target.value } : undefined); }}
          />
          <div className="timelineAudioControlRow">
            <Typography.Text type="secondary">Volume</Typography.Text>
            <Slider
              min={0}
              max={1.5}
              step={0.05}
              value={demoAudio.volume ?? 1}
              onChange={value => { onUpdateDemoAudio(demoAudio.src ? { ...demoAudio, volume: Number(value) } : undefined); }}
            />
          </div>
          <div className="timelineAudioControlRow">
            <Typography.Text type="secondary">Loop</Typography.Text>
            <Switch checked={demo.loop ?? false} onChange={checked => { onUpdateDemoLoop(checked); }} />
          </div>
          {activeSceneAudio && (
            <Typography.Text type="secondary">
              Active scene overlay: {activeSceneAudio.src} · vol {Number(activeSceneAudio.volume ?? 1).toFixed(2)}
            </Typography.Text>
          )}
        </div>
        <div className="timelineModifierStack">
          <div className="timelineModifierHeader">
            <Typography.Text strong>Demo post stack</Typography.Text>
            <Space>
              <Select
                size="small"
                value={pendingModifierImpl}
                options={modifierOptions}
                onChange={value => { setPendingModifierImpl(value); }}
                style={{ width: 180 }}
              />
              <Button size="small" onClick={() => { onAddDemoModifier(pendingModifierImpl); }}>Add modifier</Button>
            </Space>
          </div>
          {demoModifiers.length === 0 && <Typography.Text type="secondary">No demo-wide modifiers yet.</Typography.Text>}
          {demoModifiers.map((entry, index) => (
            <div key={entry.id} className="timelineModifierRow">
              <Input
                size="small"
                value={entry.id}
                onChange={event => { onUpdateDemoModifier(entry.id, current => ({ ...current, id: event.target.value })); }}
              />
              <Select
                size="small"
                value={entry.impl}
                options={modifierOptions}
                style={{ width: 180 }}
                onChange={value => { onUpdateDemoModifier(entry.id, current => ({ ...current, impl: value })); }}
              />
              <Switch
                checked={entry.enabled !== false}
                onChange={checked => { onUpdateDemoModifier(entry.id, current => ({ ...current, enabled: checked })); }}
              />
              <Input
                size="small"
                value={JSON.stringify(entry.config)}
                onChange={event => {
                  try {
                    onUpdateDemoModifier(entry.id, current => ({
                      ...current,
                      config: event.target.value ? JSON.parse(event.target.value) as Record<string, unknown> : {},
                    }))
                  } catch {
                    // Keep editing resilient while the JSON is temporarily incomplete.
                  }
                }}
              />
              <Button size="small" disabled={index === 0} onClick={() => { onMoveDemoModifier(entry.id, -1); }}>Up</Button>
              <Button size="small" disabled={index === demoModifiers.length - 1} onClick={() => { onMoveDemoModifier(entry.id, 1); }}>Down</Button>
              <Button size="small" danger onClick={() => { onRemoveDemoModifier(entry.id); }}>Delete</Button>
            </div>
          ))}
        </div>
        {sections.map(section => {
          const source = sectionSource(section.id)
          return (
            <div key={section.id} className={`timelineSectionButton ${activeSectionId === section.id ? 'timelineSectionButtonActive' : ''}`}>
              <div className="timelineSectionHeader">
                <Input
                  size="small"
                  value={source?.id ?? section.id}
                  onChange={event => { onUpdateSection(section.id, current => ({ ...current, id: event.target.value })); }}
                />
                <Button size="small" className="timelineTransitionButton" onClick={() => { setEditingTransitionSectionId(section.id); }}>
                  Transition: {transitionLabel(source, section)}
                </Button>
              </div>
              <div className="timelineSectionMeta">
                <Typography.Text type="secondary">{formatTime(section.start)} - {formatTime(section.end)}</Typography.Text>
                <Button size="small" onClick={() => { onJumpToSection(section.id, section.start); }}>Jump</Button>
              </div>
              <div className="timelineSectionEditor">
                <Input
                  size="small"
                  value={source?.scene ?? ''}
                  placeholder="scene path"
                  onChange={event => { onUpdateSection(section.id, current => ({ ...current, scene: event.target.value })); }}
                />
                <InputNumber
                  size="small"
                  value={source?.duration}
                  min={0.1}
                  placeholder="duration"
                  onChange={value => { onUpdateSection(section.id, current => ({ ...current, duration: value ?? undefined })); }}
                />
              </div>
              <div className="timelineSectionActions">
                <Tag>{draggingSectionId === section.id ? 'Dragging' : 'Drag the range above to reorder'}</Tag>
                <Button size="small" onClick={() => { onDuplicateSection(section.id); }}>Duplicate</Button>
                <Button size="small" danger onClick={() => { onDeleteSection(section.id); }}>Delete</Button>
              </div>
            </div>
          )
        })}
      </Space>
      <Modal
        title={editingSection ? `Transition: ${editingSection.id}` : 'Transition'}
        open={Boolean(editingSection)}
        onCancel={() => { setEditingTransitionSectionId(null); }}
        footer={null}
      >
        {editingSection && (
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <div className="timelineTransitionField">
              <Typography.Text type="secondary">Type</Typography.Text>
              <Select
                value={editingSection.transition?.type ?? 'cut'}
                onChange={value => { updateTransition(editingSection.id, current => (
                  value === 'cut' ? { type: 'cut' } : { ...current, type: value }
                )); }}
                options={transitionTypes.map(value => ({ label: value, value }))}
              />
            </div>
            <div className="timelineTransitionField">
              <Typography.Text type="secondary">Duration</Typography.Text>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={0.1}
                value={editingSection.transition?.duration ?? 0}
                onChange={value => { updateTransition(editingSection.id, current => ({
                  ...current,
                  duration: value ?? 0,
                })); }}
              />
            </div>
            <div className="timelineTransitionField">
              <Typography.Text type="secondary">Easing</Typography.Text>
              <Select
                value={editingSection.transition?.easing ?? 'smooth'}
                onChange={value => { updateTransition(editingSection.id, current => ({
                  ...current,
                  easing: value,
                })); }}
                options={easingModes.map(value => ({ label: value, value }))}
              />
            </div>
            {(editingSection.transition?.type ?? 'cut') === 'flash' && (
              <div className="timelineTransitionField">
                <Typography.Text type="secondary">Flash color</Typography.Text>
                <ColorPicker
                  value={editingSection.transition?.flashColor ?? '#ffffff'}
                  onChange={value => { updateTransition(editingSection.id, current => ({
                    ...current,
                    flashColor: toHexColor(fromHexColor(value.toHexString())) ?? '#ffffff',
                  })); }}
                />
              </div>
            )}
          </Space>
        )}
      </Modal>
    </Card>
  )
}
