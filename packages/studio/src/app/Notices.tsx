import type { AssetProblem } from '../engine/document'
import { baseName } from '../engine/paths'
import { Notice } from '../ui/kit'
import { useStudio } from './studio-context'

// Selectors must return stable values: a fresh [] each time would re-render forever.
const NO_PROBLEMS: AssetProblem[] = []

/** Load errors, render failures and missing assets, shown instead of failing silently. */
export function Notices() {
  const status = useStudio(s => s.status)
  const error = useStudio(s => s.error)
  const renderError = useStudio(s => s.renderError)
  const assetProblems = useStudio(s => s.document?.assetProblems ?? NO_PROBLEMS)
  if (status !== 'error' && !renderError && assetProblems.length === 0) return null
  return (
    <div className="notices">
      {status === 'error' && <Notice kind="error"><strong>Could not open the file.</strong> {error}</Notice>}
      {renderError && <Notice kind="error"><strong>Rendering stopped.</strong> {renderError}</Notice>}
      {assetProblems.length > 0 && (
        <Notice kind="warning">
          <strong>{assetProblems.length === 1 ? 'An asset' : `${assetProblems.length} assets`} could not load</strong>; the nodes fall back to their defaults.
          <ul>
            {assetProblems.map(p => (
              <li key={`${p.scenePath}:${p.nodeId}:${p.url}`}>
                <code>{baseName(p.scenePath)}</code> · {p.nodeId}: <code>{p.url}</code>: {p.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  )
}
