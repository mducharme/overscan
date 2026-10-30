import type { JSX } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow'

function StudioEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  label,
  color,
}: EdgeProps & { color: string }): JSX.Element {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  })

  return (
    <>
      {selected && (
        <BaseEdge
          id={`${id}-glow`}
          path={path}
          style={{
            stroke: color,
            strokeWidth: 6,
            opacity: 0.18,
          }}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />
      {typeof label === 'string' && label.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="studioFlowEdgeLabel"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export function BufferFlowEdge(props: EdgeProps): JSX.Element {
  return <StudioEdge {...props} color="#E8570A" />
}

export function SignalFlowEdge(props: EdgeProps): JSX.Element {
  return <StudioEdge {...props} color="#1D9E75" />
}

export function MaskFlowEdge(props: EdgeProps): JSX.Element {
  return <StudioEdge {...props} color="#7F77DD" />
}
