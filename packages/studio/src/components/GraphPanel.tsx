import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd'
import {
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type Connection,
  type IsValidConnection,
  type EdgeMouseHandler,
  type NodeDragHandler,
  type NodeTypes,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from 'reactflow'
import type { Scene } from '@overscan/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferFlowEdge, MaskFlowEdge, SignalFlowEdge } from './graph/StudioFlowEdge'
import { StudioFlowNode } from './graph/StudioFlowNode'
import { NODE_CATALOG, type NodeCatalogItem } from '../graph/node-catalog'
import { sceneToFlow } from '../graph/scene-flow'
import type { StoredNodePosition } from '../store/studio'

const nodeTypes: NodeTypes = {
  studioNode: StudioFlowNode,
}

const edgeTypes: EdgeTypes = {
  bufferEdge: BufferFlowEdge,
  signalEdge: SignalFlowEdge,
  maskEdge: MaskFlowEdge,
}

export function GraphPanel({
  scene,
  selectedNodeId,
  selectedEdgeId,
  nodePositions,
  nodeThumbnails,
  rendererBadges,
  readOnly,
  graphError,
  onSelectNode,
  onSelectEdge,
  onNodePositionChange,
  onConnectNodes,
  onValidateConnection,
  onAddNode,
  onAutoLayout,
  onSceneChange,
}: {
  scene: Scene | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  nodePositions: Record<string, StoredNodePosition>
  nodeThumbnails: Record<string, { src: string }>
  rendererBadges: Record<string, string>
  readOnly: boolean
  graphError: string | null
  onSelectNode(nodeId: string | null): void
  onSelectEdge(edgeId: string | null): void
  onNodePositionChange(nodeId: string, position: StoredNodePosition): void
  onConnectNodes(connection: Connection): void
  onValidateConnection(connection: Connection): string | null
  onAddNode(item: NodeCatalogItem): void
  onAutoLayout(): void
  onSceneChange(scene: Scene): void
}): JSX.Element {
  const CATEGORY_LABELS: Record<NodeCatalogItem['type'], string> = {
    generator: 'Generators',
    modifier: 'Modifiers',
    compositor: 'Compositors',
    signal: 'Signal Sources',
  }
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedImpl, setSelectedImpl] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [layoutLocked, setLayoutLocked] = useState(false)
  const [flashInvalid, setFlashInvalid] = useState(false)
  const flowRef = useRef<ReactFlowInstance | null>(null)
  const flow = scene ? sceneToFlow(scene, nodePositions, nodeThumbnails, rendererBadges) : null
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase()
    return [...NODE_CATALOG]
      .sort((a, b) => a.label.localeCompare(b.label))
      .filter(item => {
        if (!query) return true
        return item.label.toLowerCase().includes(query) || item.impl.toLowerCase().includes(query) || item.type.includes(query)
      })
  }, [search])
  const groupedCatalog = useMemo(() => ([
    'generator',
    'modifier',
    'compositor',
    'signal',
  ] as const).map(type => ({
    type,
    label: CATEGORY_LABELS[type],
    items: filteredCatalog.filter(item => item.type === type),
  })).filter(group => group.items.length > 0), [filteredCatalog])
  const onNodeClick: NodeMouseHandler = (_event, node) => {
    onSelectNode(node.id)
  }
  const onEdgeClick: EdgeMouseHandler = (_event, edge) => {
    onSelectEdge(edge.id)
  }
  const onNodeDragStop: NodeDragHandler = (_event, node) => {
    onNodePositionChange(node.id, node.position)
  }
  const isValidConnection: IsValidConnection = connection => onValidateConnection({
    source: connection.source ?? null,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target ?? null,
    targetHandle: connection.targetHandle ?? null,
  }) === null
  function confirmAddNode(): void {
    const item = NODE_CATALOG.find(entry => entry.impl === selectedImpl)
    if (!item) return
    onAddNode(item)
    setPaletteOpen(false)
    setSelectedImpl(undefined)
    setSearch('')
  }

  useEffect(() => {
    if (!graphError) return
    setFlashInvalid(true)
    const timer = window.setTimeout(() => setFlashInvalid(false), 320)
    return () => window.clearTimeout(timer)
  }, [graphError])

  return (
    <Card
      className="studioPanel"
      title="Scene Graph"
      extra={(
        <Space>
          <Typography.Text type="secondary">{scene?.graph.nodes.length ?? 0} nodes</Typography.Text>
          <Button size="small" disabled={!scene} onClick={() => setSettingsOpen(true)}>Settings</Button>
          <Button size="small" disabled={readOnly || !scene} onClick={() => setPaletteOpen(true)}>Add node</Button>
          <Tooltip title="Fit graph">
            <Button size="small" onClick={() => void flowRef.current?.fitView({ padding: 0.2, duration: 250 })}>Fit</Button>
          </Tooltip>
          <Tooltip title="Auto-layout nodes">
            <Button size="small" disabled={!scene} onClick={onAutoLayout}>Auto</Button>
          </Tooltip>
          <Tooltip title="Lock node dragging">
            <Button size="small" type={layoutLocked ? 'primary' : 'default'} onClick={() => setLayoutLocked(current => !current)}>
              Lock
            </Button>
          </Tooltip>
        </Space>
      )}
    >
      {!scene || scene.graph.nodes.length === 0 || !flow ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No scene graph loaded" />
      ) : (
        <div className={`graphFlow ${flashInvalid ? 'graphFlowInvalid' : ''}`}>
          <ReactFlowProvider>
            <ReactFlow
              onInit={instance => { flowRef.current = instance }}
              nodes={flow.nodes.map(node => ({
                ...node,
                selected: node.id === selectedNodeId,
              }))}
              edges={flow.edges.map(edge => ({
                ...edge,
                selected: edge.id === selectedEdgeId,
                markerEnd: { type: MarkerType.ArrowClosed, color: String(edge.style?.stroke ?? '#E8570A') },
              }))}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              nodesDraggable={!layoutLocked}
              nodesConnectable={!readOnly}
              elementsSelectable
              connectionLineType={ConnectionLineType.SmoothStep}
              isValidConnection={isValidConnection}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onConnect={onConnectNodes}
              onNodeDragStop={onNodeDragStop}
              onPaneClick={() => {
                onSelectNode(null)
                onSelectEdge(null)
              }}
              proOptions={{ hideAttribution: true }}
            >
              <MiniMap
                pannable
                zoomable
                nodeColor={node => String(node.data.color)}
                maskColor="rgba(0, 0, 0, 0.65)"
              />
              <Controls showInteractive={false} />
              <Background color="rgba(255,255,255,0.08)" gap={24} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      )}
      {graphError && <Alert className="previewAlert" type="warning" showIcon message={graphError} />}
      <Modal
        title="Add node"
        open={paletteOpen}
        width={920}
        onOk={confirmAddNode}
        okButtonProps={{ disabled: !selectedImpl }}
        onCancel={() => {
          setPaletteOpen(false)
          setSearch('')
        }}
      >
        <Input
          placeholder="Search nodes..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          style={{ marginBottom: 12 }}
        />
        <div className="nodePickerGrid">
          {groupedCatalog.map(group => (
            <section key={group.type} className="nodePickerGroup">
              <div className="nodePickerGroupHeader">
                <Typography.Title level={5}>{group.label}</Typography.Title>
                <Tag>{group.items.length}</Tag>
              </div>
              <div className="nodePickerGroupGrid">
                {group.items.map(item => (
                  <button
                    key={item.impl}
                    type="button"
                    className={`nodePickerOption ${selectedImpl === item.impl ? 'nodePickerOptionSelected' : ''}`}
                    onClick={() => setSelectedImpl(item.impl)}
                  >
                    <div className="nodePickerHeader">
                      <Typography.Text strong>{item.label}</Typography.Text>
                      <Tag>{item.type}</Tag>
                    </div>
                    <Typography.Text type="secondary">{item.impl}</Typography.Text>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {filteredCatalog.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No nodes match your search" />
          )}
        </div>
      </Modal>
      <Modal
        title="Scene Graph Settings"
        open={settingsOpen}
        footer={null}
        onCancel={() => setSettingsOpen(false)}
      >
        {!scene ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No scene loaded" />
        ) : (
          <div className="graphSettingsModal">
            <Typography.Text type="secondary">
              Choose which node drives each sink output.
            </Typography.Text>
            {(['browser', 'terminal', 'export'] as const).map(output => (
              <div key={output} className="graphSettingsRow">
                <Typography.Text strong>{output}</Typography.Text>
                <Select
                  value={scene.graph.outputs[output]}
                  style={{ width: '100%' }}
                  options={scene.graph.nodes.map(node => ({
                    label: `${node.id} (${node.impl})`,
                    value: node.id,
                  }))}
                  onChange={value => {
                    onSelectNode(null)
                    onSelectEdge(null)
                    onSceneChange({
                      ...scene,
                      graph: {
                        ...scene.graph,
                        outputs: {
                          ...scene.graph.outputs,
                          [output]: value,
                        },
                      },
                    })
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  )
}
