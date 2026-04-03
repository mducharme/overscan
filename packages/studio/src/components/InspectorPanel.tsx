import { Button, Card, Collapse, ColorPicker, Descriptions, Empty, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, Typography } from 'antd'
import type { Scene, SceneEdge, SceneNode } from '@overscan/types'
import { getConfigFieldHint } from '../graph/node-catalog'
import { fromHexColor, isAnimatableValue, parseConfigValue, toHexColor } from '../lib/preview'

type PaletteValue = Array<[number, number, number]>

function isPaletteValue(value: unknown): value is PaletteValue {
  return Array.isArray(value) && value.every(entry =>
    Array.isArray(entry) &&
    entry.length >= 3 &&
    entry.slice(0, 3).every(channel => typeof channel === 'number' && Number.isFinite(channel)),
  )
}

export function InspectorPanel({
  scene,
  selectedNode,
  selectedEdge,
  edgeInspectorData,
  shaderDraft,
  signalOptions,
  readOnly,
  onClear,
  onSceneChange,
  onSceneFieldChange,
  onNodeConfigChange,
  onNodeRename,
  onNodeResolutionChange,
  onNodeTimingChange,
  onDuplicateNode,
  onDeleteNode,
  onConnectSignal,
  onRemoveEdge,
  onUpdateEdge,
  onOpenShaderEditor,
  onShaderDraftChange,
  onSaveShaderDraft,
}: {
  scene: Scene | null
  selectedNode: SceneNode | null
  selectedEdge: SceneEdge | null
  edgeInspectorData: {
    kind: 'buffer' | 'signal' | 'mask'
    currentValue?: number
    min?: number
    max?: number
    mean?: number
    thumbnailSrc?: string
    width?: number
    height?: number
  } | null
  shaderDraft: string
  signalOptions: Array<{ key: string; nodeId: string; output: string; value: number }>
  readOnly: boolean
  onClear(): void
  onSceneChange(scene: Scene): void
  onSceneFieldChange<K extends keyof Scene>(key: K, value: Scene[K]): void
  onNodeConfigChange(nodeId: string, key: string, value: unknown): void
  onNodeRename(nodeId: string): void
  onNodeResolutionChange(nodeId: string, resolution: { width: number; height: number } | null): void
  onNodeTimingChange(nodeId: string, timing: { startTime?: number; endTime?: number }): void
  onDuplicateNode(): void
  onDeleteNode(): void
  onConnectSignal(nodeId: string, key: string, sourceKey: string | null): void
  onRemoveEdge(): void
  onUpdateEdge(nextMeta: Partial<SceneEdge>): void
  onOpenShaderEditor(): void
  onShaderDraftChange(value: string): void
  onSaveShaderDraft(): void
}): JSX.Element {
  function updatePalette(key: string, palette: PaletteValue): void {
    if (!selectedNode) return
    onNodeConfigChange(selectedNode.id, key, palette)
  }

  function renderNodeField(key: string, value: unknown): JSX.Element {
    if (!selectedNode) return <></>
    const hint = getConfigFieldHint(selectedNode.impl, key, value)
    if (hint === 'boolean') {
      return (
        <Switch
          checked={Boolean(value)}
          disabled={readOnly}
          onChange={checked => onNodeConfigChange(selectedNode.id, key, checked)}
        />
      )
    }
    if (hint === 'number' || hint === 'animatable') {
      const currentNumber = typeof value === 'number' ? value : isAnimatableValue(value) ? Number((value as { track?: string }).track ? 0 : 0) : 0
      return (
        <Space.Compact block>
          <InputNumber
            style={{ width: '100%' }}
            value={typeof value === 'number' ? value : currentNumber}
            disabled={readOnly || (typeof value === 'object' && value !== null && !Array.isArray(value))}
            step={0.05}
            onChange={next => onNodeConfigChange(selectedNode.id, key, next ?? 0)}
          />
          {hint === 'animatable' && (
            <Select
              style={{ width: 170 }}
              value={
                typeof value === 'object' && value && 'node' in value && 'output' in value
                  ? `${value.node}.${value.output}`
                  : typeof value === 'object' && value && 'track' in value
                    ? `track:${value.track}`
                    : 'literal'
              }
              onChange={next => {
                if (next === 'literal') onConnectSignal(selectedNode.id, key, null)
                else if (next.startsWith('track:')) onNodeConfigChange(selectedNode.id, key, { track: next.slice(6) })
                else onConnectSignal(selectedNode.id, key, next)
              }}
              options={[
                { label: 'Literal', value: 'literal' },
                ...scene!.tracks.map(track => ({ label: `Track: ${track.name}`, value: `track:${track.name}` })),
                ...signalOptions.map(option => ({
                  label: `${option.nodeId}.${option.output} (${option.value.toFixed(2)})`,
                  value: option.key,
                })),
              ]}
            />
          )}
        </Space.Compact>
      )
    }
    if (hint === 'color') {
      const color = toHexColor(value) ?? '#ffffff'
      return (
        <ColorPicker
          value={color}
          disabled={readOnly}
          onChange={next => onNodeConfigChange(selectedNode.id, key, fromHexColor(next.toHexString()))}
        />
      )
    }
    if (hint === 'glsl') {
      return (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Input.TextArea rows={8} value={String(value ?? '')} disabled={readOnly} onChange={event => onNodeConfigChange(selectedNode.id, key, event.target.value)} />
          <Button size="small" onClick={onOpenShaderEditor}>Open shader editor</Button>
        </Space>
      )
    }
    if (hint === 'palette' && isPaletteValue(value)) {
      return (
        <div className="paletteEditor">
          <div className="paletteSwatchRow">
            {value.map((entry, index) => (
              <button
                key={`${key}:swatch:${index}`}
                type="button"
                className="paletteSwatchPreview"
                style={{ background: toHexColor(entry) ?? '#ffffff' }}
                onClick={() => {}}
              />
            ))}
          </div>
          <div className="paletteList">
            {value.map((entry, index) => (
              <div key={`${key}:${index}`} className="paletteEntry">
                <ColorPicker
                  value={toHexColor(entry) ?? '#ffffff'}
                  disabled={readOnly}
                  onChange={next => updatePalette(key, value.map((item, itemIndex) =>
                    itemIndex === index ? fromHexColor(next.toHexString()) : item,
                  ) as PaletteValue)}
                />
                <Input
                  value={toHexColor(entry) ?? '#ffffff'}
                  disabled={readOnly}
                  onChange={event => updatePalette(key, value.map((item, itemIndex) =>
                    itemIndex === index ? fromHexColor(event.target.value) : item,
                  ) as PaletteValue)}
                />
                <Space.Compact>
                  <Button
                    size="small"
                    disabled={readOnly || index === 0}
                    onClick={() => {
                      const next = [...value]
                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                      updatePalette(key, next as PaletteValue)
                    }}
                  >
                    Up
                  </Button>
                  <Button
                    size="small"
                    disabled={readOnly || index === value.length - 1}
                    onClick={() => {
                      const next = [...value]
                      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                      updatePalette(key, next as PaletteValue)
                    }}
                  >
                    Down
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={readOnly || value.length <= 1}
                    onClick={() => updatePalette(key, value.filter((_, itemIndex) => itemIndex !== index) as PaletteValue)}
                  >
                    Remove
                  </Button>
                </Space.Compact>
              </div>
            ))}
          </div>
          <Space>
            <Button
              size="small"
              disabled={readOnly}
              onClick={() => updatePalette(key, [...value, [255, 255, 255]])}
            >
              Add color
            </Button>
            <Button
              size="small"
              disabled={readOnly}
              onClick={() => navigator.clipboard.writeText(JSON.stringify(value))}
            >
              Copy JSON
            </Button>
          </Space>
        </div>
      )
    }
    if (hint === 'json') {
      return (
        <Input.TextArea
          rows={4}
          value={JSON.stringify(value)}
          disabled={readOnly}
          onChange={event => onNodeConfigChange(selectedNode.id, key, parseConfigValue(value, event.target.value))}
        />
      )
    }
    return (
      <Input
        value={typeof value === 'string' ? value : JSON.stringify(value)}
        disabled={readOnly}
        onChange={event => onNodeConfigChange(selectedNode.id, key, parseConfigValue(value, event.target.value))}
      />
    )
  }

  return (
    <Card
      className="studioPanel"
      title="Inspector"
      extra={<Button size="small" onClick={onClear}>Clear</Button>}
    >
      {!scene && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No scene selected" />}
      {scene && !selectedNode && !selectedEdge && (() => {
        const sceneAudio = typeof scene.audio === 'string'
          ? { src: scene.audio, volume: 1 }
          : scene.audio ?? { src: '', volume: 1 }
        return (
        <Form layout="vertical">
          <Form.Item label="Title">
            <Input value={scene.title} disabled={readOnly} onChange={event => onSceneFieldChange('title', event.target.value)} />
          </Form.Item>
          <Form.Item label="Duration">
            <InputNumber style={{ width: '100%' }} value={scene.duration} disabled={readOnly} step={0.1} onChange={value => onSceneFieldChange('duration', value ?? scene.duration)} />
          </Form.Item>
          <Form.Item label="BPM">
            <InputNumber style={{ width: '100%' }} value={scene.bpm} disabled={readOnly} onChange={value => onSceneFieldChange('bpm', value ?? scene.bpm)} />
          </Form.Item>
          <Form.Item label="FPS">
            <InputNumber style={{ width: '100%' }} value={scene.fps} disabled={readOnly} onChange={value => onSceneFieldChange('fps', value ?? scene.fps)} />
          </Form.Item>
          <Form.Item label="Rows Per Beat">
            <InputNumber style={{ width: '100%' }} value={scene.rowsPerBeat} disabled={readOnly} onChange={value => onSceneFieldChange('rowsPerBeat', value ?? scene.rowsPerBeat)} />
          </Form.Item>
          <Form.Item label="Audio">
            <Space.Compact block>
              <Input
                value={sceneAudio.src}
                disabled={readOnly}
                onChange={event => onSceneFieldChange('audio', event.target.value ? { ...sceneAudio, src: event.target.value } : undefined)}
              />
              <InputNumber
                min={0}
                max={1.5}
                step={0.05}
                value={sceneAudio.volume}
                disabled={readOnly}
                onChange={value => onSceneFieldChange('audio', sceneAudio.src ? { ...sceneAudio, volume: value ?? 1 } : undefined)}
              />
            </Space.Compact>
          </Form.Item>
          <Form.Item label="Resolution">
            <Space.Compact block>
              <InputNumber style={{ width: '50%' }} value={scene.resolution.width} disabled={readOnly} onChange={value => onSceneFieldChange('resolution', { ...scene.resolution, width: value ?? scene.resolution.width })} />
              <InputNumber style={{ width: '50%' }} value={scene.resolution.height} disabled={readOnly} onChange={value => onSceneFieldChange('resolution', { ...scene.resolution, height: value ?? scene.resolution.height })} />
            </Space.Compact>
          </Form.Item>
        </Form>
        )
      })()}
      {scene && selectedEdge && (
        <>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>Edge</Typography.Title>
          <Descriptions column={1} size="small" bordered items={[
            { key: 'from', label: 'From', children: `${selectedEdge.from.node}.${selectedEdge.from.output}` },
            { key: 'to', label: 'To', children: `${selectedEdge.to.node}.${selectedEdge.to.input}` },
            { key: 'z', label: 'Layer', children: (
              <InputNumber
                size="small"
                value={selectedEdge.z}
                placeholder="auto"
                onChange={value => onUpdateEdge({ z: value ?? undefined })}
              />
            ) },
            { key: 'kind', label: 'Kind', children: edgeInspectorData?.kind ?? (selectedEdge.to.input === 'mask' ? 'Mask' : selectedEdge.from.output === 'value' ? 'Signal' : 'Buffer') },
          ]} />
          {edgeInspectorData?.thumbnailSrc && (
            <div className="inspectorThumbCard">
              <img src={edgeInspectorData.thumbnailSrc} alt="Edge preview" />
              <Typography.Text type="secondary">
                {edgeInspectorData.width} x {edgeInspectorData.height}
              </Typography.Text>
            </div>
          )}
          {edgeInspectorData?.kind === 'signal' && (
            <Descriptions
              style={{ marginTop: 16 }}
              column={1}
              size="small"
              bordered
              items={[
                { key: 'current', label: 'Current', children: edgeInspectorData.currentValue?.toFixed(3) ?? '0.000' },
                { key: 'min', label: 'Min', children: edgeInspectorData.min?.toFixed(3) ?? '0.000' },
                { key: 'max', label: 'Max', children: edgeInspectorData.max?.toFixed(3) ?? '0.000' },
                { key: 'mean', label: 'Mean', children: edgeInspectorData.mean?.toFixed(3) ?? '0.000' },
              ]}
            />
          )}
          {!readOnly && (
            <Button danger style={{ marginTop: 16 }} onClick={onRemoveEdge}>
              Disconnect
            </Button>
          )}
        </>
      )}
      {scene && selectedNode && (
        <>
          <Space orientation="vertical" size="small" style={{ width: '100%' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Input size="small" value={selectedNode.id} onChange={event => onNodeRename(event.target.value)} />
                <Typography.Text type="secondary">{selectedNode.impl} · {selectedNode.type}</Typography.Text>
              </div>
              <Space>
                <Button size="small" onClick={onDuplicateNode}>Duplicate</Button>
                <Button size="small" danger onClick={onDeleteNode}>Delete</Button>
              </Space>
            </Space>
            <Tabs
              items={[
                {
                  key: 'config',
                  label: 'Config',
                  children: (
                    <Form layout="vertical" style={{ marginTop: 8 }}>
                      {Object.entries(selectedNode.config).map(([key, value]) => (
                        <Form.Item key={key} label={(
                          <Space>
                            <span>{key}</span>
                            {isAnimatableValue(value) && <Tag color="orange">~</Tag>}
                          </Space>
                        )}>
                          {renderNodeField(key, value)}
                        </Form.Item>
                      ))}
                    </Form>
                  ),
                },
                {
                  key: 'resolution',
                  label: 'Resolution',
                  children: (
                    <Space.Compact block>
                      <InputNumber
                        style={{ width: '50%' }}
                        value={selectedNode.resolution?.width}
                        placeholder="default width"
                        onChange={value => onNodeResolutionChange(selectedNode.id, value && selectedNode.resolution?.height ? { width: value, height: selectedNode.resolution.height } : null)}
                      />
                      <InputNumber
                        style={{ width: '50%' }}
                        value={selectedNode.resolution?.height}
                        placeholder="default height"
                        onChange={value => onNodeResolutionChange(selectedNode.id, value && selectedNode.resolution?.width ? { width: selectedNode.resolution.width, height: value } : null)}
                      />
                    </Space.Compact>
                  ),
                },
                {
                  key: 'timing',
                  label: 'Timing',
                  children: (
                    <Space.Compact block>
                      <InputNumber
                        style={{ width: '50%' }}
                        min={0}
                        step={0.1}
                        value={selectedNode.startTime}
                        placeholder="start (s)"
                        onChange={value => onNodeTimingChange(selectedNode.id, {
                          startTime: value ?? undefined,
                          endTime: selectedNode.endTime,
                        })}
                      />
                      <InputNumber
                        style={{ width: '50%' }}
                        min={0}
                        step={0.1}
                        value={selectedNode.endTime}
                        placeholder="end (s)"
                        onChange={value => onNodeTimingChange(selectedNode.id, {
                          startTime: selectedNode.startTime,
                          endTime: value ?? undefined,
                        })}
                      />
                    </Space.Compact>
                  ),
                },
                {
                  key: 'shader',
                  label: 'Shader',
                  children: (
                    <Collapse
                      items={[
                        {
                          key: 'shader-editor',
                          label: 'GLSL editor',
                          children: (
                            <Space orientation="vertical" style={{ width: '100%' }}>
                              <Input.TextArea rows={10} value={shaderDraft} onChange={event => onShaderDraftChange(event.target.value)} />
                              <Space>
                                <Button size="small" onClick={onOpenShaderEditor}>Load from node</Button>
                                <Button type="primary" size="small" onClick={onSaveShaderDraft}>Save shader</Button>
                              </Space>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Space>
        </>
      )}
    </Card>
  )
}
