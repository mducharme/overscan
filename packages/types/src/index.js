// ─── AnimatableFloat ──────────────────────────────────────────────────────────
//
// Any numeric parameter on any node. Resolved by the compositor before each
// node executes. Literals pass through. Track refs are looked up in
// signal.tracks. Node output refs resolve from the signal source tick map.
/** Resolve a literal, Rocket track ref, or signal-node output ref to a number. */
export function resolveAnimatableFloat(v, signal) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (v && typeof v === 'object') {
        if ('track' in v && typeof v.track === 'string') {
            return signal.tracks[v.track] ?? 0;
        }
        if ('node' in v &&
            'output' in v &&
            typeof v.node === 'string' &&
            typeof v.output === 'string') {
            const key = `${v.node}.${v.output}`;
            return signal.sources[key] ?? 0;
        }
    }
    return 0;
}
//# sourceMappingURL=index.js.map