import type { JSX } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Tag, Typography } from 'antd'
import type { StudioFlowNodeData, StudioPort } from '../../graph/scene-flow'

const TYPE_LABEL: Record<StudioFlowNodeData['type'], string> = {
  generator: 'GEN',
  modifier: 'MOD',
  compositor: 'COMP',
  signal: 'SIG',
}

function portColor(port: StudioPort): string {
  if (port.kind === 'signal') return '#1D9E75'
  if (port.kind === 'mask') return '#7F77DD'
  return '#E8570A'
}

function renderHandle(port: StudioPort, side: 'source' | 'target') {
  return (
    <Handle
      key={`${side}:${port.id}`}
      id={port.id}
      type={side}
      position={side === 'source' ? Position.Right : Position.Left}
      className="studioFlowHandle"
      style={{
        background: portColor(port),
        borderColor: portColor(port),
        top: port.offset,
      }}
      isConnectable
    />
  )
}

export function StudioFlowNode({ data, selected }: NodeProps<StudioFlowNodeData>): JSX.Element {
  return (
    <div className={`studioFlowNode ${selected ? 'studioFlowNodeSelected' : ''}`} style={{ ['--studio-node-accent' as string]: data.color }}>
      {data.inputs.map(port => renderHandle(port, 'target'))}
      {data.outputs.map(port => renderHandle(port, 'source'))}

      <div className="studioFlowNodeHeader">
        <Tag color={data.tagColor} variant="filled">{TYPE_LABEL[data.type]}</Tag>
        <Typography.Text strong>{data.label}</Typography.Text>
        {data.rendererBadge && <Tag variant="filled">{data.rendererBadge}</Tag>}
      </div>

      <Typography.Text className="studioFlowNodeImpl" type="secondary">
        {data.impl}
      </Typography.Text>

      {data.inputs.length > 0 && (
        <div className="studioFlowNodePorts studioFlowNodePortsLeft">
          {data.inputs.map(port => (
            <span key={`input:${port.id}`} className="studioFlowPortLabel">
              {port.label}
            </span>
          ))}
        </div>
      )}

      {data.outputs.length > 0 && (
        <div className="studioFlowNodePorts studioFlowNodePortsRight">
          {data.outputs.map(port => (
            <span key={`output:${port.id}`} className="studioFlowPortLabel">
              {port.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
