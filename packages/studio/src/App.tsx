import { Alert, App as AntApp, ConfigProvider, Spin, theme } from 'antd'
import { useMemo } from 'react'
import { GraphPanel } from './components/GraphPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { StudioToolbar } from './components/StudioToolbar'
import { TimelinePanel } from './components/TimelinePanel'
import { useStudioApp } from './hooks/useStudioApp'

export default function App(): JSX.Element {
  const {
    glCanvasRef,
    canvas2dRef,
    documentState,
    loading,
    error,
    previewState,
    graphError,
    nodeThumbnails,
    rendererBadges,
    edgeInspectorData,
    activeSection,
    activeScene,
    selectedNode,
    selectedEdge,
    externalReloadAvailable,
    shaderDraft,
    setShaderDraft,
    signalOptions,
    handleSave,
    rewind,
    togglePlayback,
    seekToTime,
    seekToTimecode,
    stepFrames,
    setPlaybackRate,
    toggleLooping,
    updateScene,
    updateSceneMetadata,
    updateNodeConfig,
    renameSelectedNode,
    setNodeResolution,
    setNodeTiming,
    updateNodePosition,
    autoLayoutGraph,
    addNode,
    connectNodes,
    connectNodeParamToSignal,
    validateConnection,
    removeSelectedEdge,
    updateSelectedEdgeMeta,
    deleteSelection,
    duplicateSelection,
    undoGraphChange,
    redoGraphChange,
    canUndo,
    canRedo,
    jumpToSection,
    updateDemoSection,
    moveDemoSection,
    addDemoSection,
    removeDemoSection,
    duplicateDemoSection,
    updateDemoAudio,
    updateDemoLoop,
    updateDemoModifier,
    addDemoModifier,
    moveDemoModifier,
    removeDemoModifier,
    documentAudioTimeline,
    activeSceneAudio,
    audioError,
    reloadExternalChanges,
    openShaderEditor,
    saveShaderDraft,
    store,
  } = useStudioApp()

  const shellStyle = useMemo(() => ({
    gridTemplateColumns: `minmax(320px, ${store.panelLayout.graphWidth}%) 8px minmax(420px, 1fr)`,
  }), [store.panelLayout.graphWidth])

  const rightColumnStyle = useMemo(() => ({
    gridTemplateRows: `minmax(260px, ${100 - store.panelLayout.inspectorHeight}%) 8px minmax(240px, ${store.panelLayout.inspectorHeight}%)`,
  }), [store.panelLayout.inspectorHeight])

  const timelineStyle = useMemo(() => ({
    height: `${store.panelLayout.timelineHeight}px`,
  }), [store.panelLayout.timelineHeight])

  const contentGridStyle = useMemo(() => {
    if (documentState?.fileType !== 'demo' || !documentState.demo) return undefined
    return {
      display: 'grid',
      gridTemplateRows: `minmax(0, 1fr) 8px ${store.panelLayout.timelineHeight}px`,
      minHeight: 0,
      height: '100%',
    } as const
  }, [documentState, store.panelLayout.timelineHeight])

  function beginHorizontalResize(): void {
    const onMove = (event: MouseEvent) => {
      const next = (event.clientX / window.innerWidth) * 100
      store.setPanelLayout({ graphWidth: Math.max(25, Math.min(65, next)) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function beginInspectorResize(): void {
    const onMove = (event: MouseEvent) => {
      const next = ((window.innerHeight - event.clientY) / window.innerHeight) * 100
      store.setPanelLayout({ inspectorHeight: Math.max(24, Math.min(60, next)) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function beginTimelineResize(): void {
    const onMove = (event: MouseEvent) => {
      const next = window.innerHeight - event.clientY - 16
      store.setPanelLayout({ timelineHeight: Math.max(120, Math.min(320, next)) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorBgBase: '#0f0f0f',
          colorBgContainer: '#161616',
          colorBgElevated: '#1e1e1e',
          colorBorder: 'rgba(255,255,255,0.08)',
          colorText: '#e8e8e8',
          colorTextSecondary: '#888888',
          colorPrimary: '#E8570A',
          borderRadius: 8,
          fontSize: 13,
        },
      }}
    >
      <AntApp>
        <div className="studioShell">
          <header className="studioHeader">
            <StudioToolbar
              fileName={store.filePath.split(/[/\\]/).at(-1) ?? 'studio'}
              unsaved={store.unsaved}
              canSave={Boolean(documentState)}
              canUndo={canUndo}
              canRedo={canRedo}
              canDuplicate={Boolean(store.selectedNodeId)}
              canDelete={Boolean(store.selectedNodeId || store.selectedEdgeId)}
              playing={store.playing}
              currentTime={store.currentTime}
              duration={documentState?.duration ?? 0}
              bpm={activeScene?.bpm ?? documentState?.scene?.bpm ?? null}
              renderer={store.renderer}
              playbackRate={store.playbackRate}
              loopEnabled={Boolean(store.loopRange)}
              profileOverlay={store.profileOverlay}
              onSave={() => void handleSave()}
              onDuplicate={duplicateSelection}
              onDelete={deleteSelection}
              onUndo={undoGraphChange}
              onRedo={redoGraphChange}
              onRewind={rewind}
              onTogglePlayback={togglePlayback}
              onSeek={seekToTimecode}
              onStepBack={() => stepFrames(-1)}
              onStepForward={() => stepFrames(1)}
              onPlaybackRateChange={setPlaybackRate}
              onRendererChange={store.setRenderer}
              onToggleLoop={toggleLooping}
              onToggleProfile={() => store.setProfileOverlay(!store.profileOverlay)}
              onBpmChange={value => updateSceneMetadata('bpm', value)}
            />
          </header>

          <main className="studioContent" style={contentGridStyle}>
            <div
              className={`studioShellGrid ${documentState?.fileType === 'demo' ? 'studioGridWithTimeline' : 'studioGridSceneOnly'}`}
              style={shellStyle}
            >
              <section className="studioSider">
                <GraphPanel
                  scene={activeScene}
                  selectedNodeId={store.selectedNodeId}
                  selectedEdgeId={store.selectedEdgeId}
                  nodePositions={store.nodePositions}
                  nodeThumbnails={nodeThumbnails}
                  rendererBadges={rendererBadges}
                  readOnly={false}
                  graphError={graphError}
                  onSelectNode={store.selectNode}
                  onSelectEdge={store.selectEdge}
                  onNodePositionChange={updateNodePosition}
                  onConnectNodes={connectNodes}
                  onValidateConnection={validateConnection}
                  onAddNode={addNode}
                  onAutoLayout={autoLayoutGraph}
                  onSceneChange={updateScene}
                />
              </section>
              <div className="studioResizeHandle studioResizeHandleVertical" onMouseDown={beginHorizontalResize} />

              <section className="studioMainColumn" style={rightColumnStyle}>
                <div className="studioPreviewRegion">
                  <PreviewPanel
                    renderer={store.renderer}
                    previewState={previewState}
                    resolution={documentState?.resolution ?? null}
                    playbackRate={store.playbackRate}
                    profileOverlay={store.profileOverlay}
                    glCanvasRef={glCanvasRef}
                    canvas2dRef={canvas2dRef}
                    onResolutionChange={resolution => {
                      if (activeScene) {
                        updateSceneMetadata('resolution', resolution)
                      }
                    }}
                    onSeek={seekToTime}
                    onViewportChange={store.setPreviewSize}
                  />
                </div>
                <div className="studioResizeHandle studioResizeHandleHorizontal" onMouseDown={beginInspectorResize} />
                <div className="studioInspectorRegion">
                  <InspectorPanel
                    scene={activeScene}
                    selectedNode={selectedNode}
                    selectedEdge={selectedEdge}
                    edgeInspectorData={edgeInspectorData}
                    shaderDraft={shaderDraft}
                    signalOptions={signalOptions}
                    readOnly={false}
                    onClear={() => {
                      store.selectNode(null)
                      store.selectEdge(null)
                    }}
                    onSceneChange={updateScene}
                    onSceneFieldChange={updateSceneMetadata}
                    onNodeConfigChange={updateNodeConfig}
                    onNodeRename={renameSelectedNode}
                    onNodeResolutionChange={setNodeResolution}
                    onNodeTimingChange={setNodeTiming}
                    onDuplicateNode={duplicateSelection}
                    onDeleteNode={deleteSelection}
                    onConnectSignal={connectNodeParamToSignal}
                    onRemoveEdge={removeSelectedEdge}
                    onUpdateEdge={updateSelectedEdgeMeta}
                    onOpenShaderEditor={openShaderEditor}
                    onShaderDraftChange={setShaderDraft}
                    onSaveShaderDraft={saveShaderDraft}
                  />
                </div>
              </section>
            </div>

            {documentState?.fileType === 'demo' && documentState.demo && (
              <div className="studioResizeHandle studioResizeHandleTimeline" onMouseDown={beginTimelineResize} />
            )}
            {documentState?.fileType === 'demo' && documentState.demo && (
              <div className="studioTimelineRegion" style={timelineStyle}>
                <TimelinePanel
                  title={documentState.demo.title}
                  demo={documentState.demo}
                  sections={documentState.sections}
                  audioTimeline={documentAudioTimeline}
                  activeSceneAudio={activeSceneAudio}
                  activeSectionId={activeSection?.id ?? null}
                  currentTime={store.currentTime}
                  duration={documentState.duration}
                  onJumpToSection={jumpToSection}
                  onSeek={seekToTime}
                  onAddSection={addDemoSection}
                  onMoveSection={moveDemoSection}
                  onDuplicateSection={duplicateDemoSection}
                  onDeleteSection={removeDemoSection}
                  onUpdateSection={updateDemoSection}
                  onUpdateDemoAudio={updateDemoAudio}
                  onUpdateDemoLoop={updateDemoLoop}
                  demoModifiers={documentState.demo.modifiers ?? []}
                  onAddDemoModifier={addDemoModifier}
                  onMoveDemoModifier={moveDemoModifier}
                  onUpdateDemoModifier={updateDemoModifier}
                  onRemoveDemoModifier={removeDemoModifier}
                />
              </div>
            )}

            {externalReloadAvailable && (
              <Alert
                className="studioGlobalAlert"
                type="warning"
                showIcon
                action={<a onClick={reloadExternalChanges}>Reload</a>}
                message="External file changes detected."
              />
            )}
            {previewState.lastError && !loading && (
              <Alert className="studioGlobalAlert" type="error" showIcon message={previewState.lastError} />
            )}
            {audioError && !loading && (
              <Alert className="studioGlobalAlert" type="warning" showIcon message={audioError} />
            )}
            {error && !loading && (
              <Alert className="studioGlobalAlert" type="error" showIcon message={error} />
            )}
            {loading && (
              <div className="studioOverlay">
                <Spin size="large" />
              </div>
            )}
          </main>
        </div>
      </AntApp>
    </ConfigProvider>
  )
}
