import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { BridgeContext, StudioContext } from './app/studio-context'
import { createHttpBridge } from './engine/bridge'
import { loadDocument } from './engine/document'
import { decodeImageInBrowser } from './engine/image-decode'
import { createStudioStore, type StudioStore } from './state/store'
import './ui/tokens.css'
import './ui/kit.css'
import './app/app.css'

declare global {
  interface Window {
    /** The studio store, for the smoke test and debugging. */
    __overscanStudio?: StudioStore
  }
}

const bridge = createHttpBridge()
const store = createStudioStore({
  load: filePath => loadDocument(bridge, filePath, { decodeImage: decodeImageInBrowser }),
  save: (filePath, text) => bridge.save(filePath, text),
  stat: filePath => bridge.stat(filePath),
})
window.__overscanStudio = store

const initialFile = new URLSearchParams(window.location.search).get('file') ?? (typeof __OVERSCAN_FILE__ === 'string' ? __OVERSCAN_FILE__ : '')
if (initialFile) void store.getState().openDocument(initialFile)

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')
createRoot(root).render(
  <BridgeContext.Provider value={bridge}>
    <StudioContext.Provider value={store}>
      <App />
    </StudioContext.Provider>
  </BridgeContext.Provider>,
)
