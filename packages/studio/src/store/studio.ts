import { create } from 'zustand'
import type { StudioFileType } from '../lib/runtime'

export type PreviewRenderer = 'ascii' | 'ansi' | '2d' | 'gl'

export interface StoredNodePosition {
  x: number
  y: number
}

export interface PanelLayoutState {
  graphWidth: number
  inspectorHeight: number
  timelineHeight: number
}

export interface LoopRange {
  start: number
  end: number
}

interface StudioState {
  filePath: string
  fileType: StudioFileType
  unsaved: boolean
  selectedNodeId: string | null
  selectedEdgeId: string | null
  activeSectionId: string | null
  renderer: PreviewRenderer
  playing: boolean
  currentTime: number
  playbackRate: number
  loopRange: LoopRange | null
  profileOverlay: boolean
  previewWidth: number
  previewHeight: number
  nodePositions: Record<string, StoredNodePosition>
  panelLayout: PanelLayoutState
  setDocument(filePath: string, fileType: StudioFileType): void
  setUnsaved(unsaved: boolean): void
  selectNode(nodeId: string | null): void
  selectEdge(edgeId: string | null): void
  setActiveSection(sectionId: string | null): void
  setRenderer(renderer: PreviewRenderer): void
  setPlaying(playing: boolean): void
  setCurrentTime(currentTime: number): void
  setPlaybackRate(playbackRate: number): void
  setLoopRange(loopRange: LoopRange | null): void
  setProfileOverlay(profileOverlay: boolean): void
  setPreviewSize(width: number, height: number): void
  setNodePositions(nodePositions: Record<string, StoredNodePosition>): void
  setNodePosition(nodeId: string, position: StoredNodePosition): void
  setPanelLayout(panelLayout: Partial<PanelLayoutState>): void
}

export const useStudioStore = create<StudioState>(set => ({
  filePath: '',
  fileType: 'scene',
  unsaved: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  activeSectionId: null,
  renderer: 'gl',
  playing: false,
  currentTime: 0,
  playbackRate: 1,
  loopRange: null,
  profileOverlay: false,
  previewWidth: 640,
  previewHeight: 360,
  nodePositions: {},
  panelLayout: {
    graphWidth: 45,
    inspectorHeight: 44,
    timelineHeight: 140,
  },
  setDocument(filePath, fileType) {
    set({
      filePath,
      fileType,
      unsaved: false,
      selectedNodeId: null,
      selectedEdgeId: null,
      activeSectionId: null,
      currentTime: 0,
      nodePositions: {},
    })
  },
  setUnsaved(unsaved) {
    set({ unsaved })
  },
  selectNode(selectedNodeId) {
    set({ selectedNodeId, selectedEdgeId: null })
  },
  selectEdge(selectedEdgeId) {
    set({ selectedEdgeId, selectedNodeId: null })
  },
  setActiveSection(activeSectionId) {
    set({ activeSectionId })
  },
  setRenderer(renderer) {
    set({ renderer })
  },
  setPlaying(playing) {
    set({ playing })
  },
  setCurrentTime(currentTime) {
    set({ currentTime })
  },
  setPlaybackRate(playbackRate) {
    set({ playbackRate })
  },
  setLoopRange(loopRange) {
    set({ loopRange })
  },
  setProfileOverlay(profileOverlay) {
    set({ profileOverlay })
  },
  setPreviewSize(previewWidth, previewHeight) {
    set({ previewWidth, previewHeight })
  },
  setNodePositions(nodePositions) {
    set({ nodePositions })
  },
  setNodePosition(nodeId, position) {
    set(state => ({
      nodePositions: {
        ...state.nodePositions,
        [nodeId]: position,
      },
    }))
  },
  setPanelLayout(panelLayout) {
    set(state => ({
      panelLayout: {
        ...state.panelLayout,
        ...panelLayout,
      },
    }))
  },
}))
