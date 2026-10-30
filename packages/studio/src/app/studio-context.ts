import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { Bridge } from '../engine/bridge'
import type { StudioActions, StudioState, StudioStore } from '../state/store'

export const StudioContext = createContext<StudioStore | null>(null)
export const BridgeContext = createContext<Bridge | null>(null)

export function useStudioStore(): StudioStore {
  const store = useContext(StudioContext)
  if (!store) throw new Error('useStudioStore must be used inside <StudioContext.Provider>')
  return store
}

/** Subscribes a component to one slice of studio state. */
export function useStudio<T>(selector: (state: StudioState & StudioActions) => T): T {
  return useStore(useStudioStore(), selector)
}

export function useBridge(): Bridge {
  const bridge = useContext(BridgeContext)
  if (!bridge) throw new Error('useBridge must be used inside <BridgeContext.Provider>')
  return bridge
}
