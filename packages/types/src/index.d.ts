export type AnimatableFloat = number | {
    track: string;
} | {
    node: string;
    output: string;
};
export type BlendMode = 'alpha' | 'additive' | 'multiply' | 'screen' | 'overlay' | 'difference' | 'mask';
export interface FrameBuffer {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    data: Uint8ClampedArray;
    texture?: WebGLTexture;
    fbo?: WebGLFramebuffer;
    clear(): void;
}
export interface BufferPool {
    acquire(width: number, height: number): FrameBuffer;
    release(buffer: FrameBuffer): void;
    retain(buffer: FrameBuffer): void;
}
export interface Signal {
    t: number;
    frame: number;
    dt: number;
    beat: number;
    bpm: number;
    rms: number;
    spectral: number;
    chroma: Float32Array;
    mfcc: Float32Array;
    tracks: Readonly<Record<string, number>>;
    sources: Readonly<Record<string, number>>;
}
export interface LoadedImageAsset {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}
export interface AssetManager {
    preloadScene(scene: Scene): Promise<void>;
    getText(url: string): string | undefined;
    getImage(url: string): LoadedImageAsset | undefined;
    getError(url: string): string | undefined;
}
export interface NodeContext {
    canvas: OffscreenCanvas | null;
    ctx2d: OffscreenCanvasRenderingContext2D | null;
    gl: WebGL2RenderingContext | null;
    assets?: AssetManager;
    pool: BufferPool;
    width: number;
    height: number;
}
export interface Generator {
    readonly type: 'generator';
    readonly id: string;
    resolution?: {
        width: number;
        height: number;
    };
    renderers: Array<'gpu' | 'cpu'>;
    config: Record<string, AnimatableFloat | unknown>;
    init(ctx: NodeContext): void;
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void;
    glsl?: string;
    uniforms?(signal: Signal): Record<string, unknown>;
    destroy(): void;
}
export interface Modifier {
    readonly type: 'modifier';
    readonly id: string;
    readonly persistent: boolean;
    config: Record<string, AnimatableFloat | unknown>;
    init(ctx: NodeContext): void;
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void;
    glsl?: string;
    destroy(): void;
}
export interface CompositorEdgeTransform {
    position: [number, number];
    scale: [number, number];
    rotation?: number;
}
export interface CompositorInputMeta {
    transform?: CompositorEdgeTransform;
}
export interface Compositor {
    readonly type: 'compositor';
    readonly id: string;
    readonly inputs: readonly string[];
    mode: BlendMode;
    opacity: AnimatableFloat;
    config: Record<string, AnimatableFloat | unknown>;
    init(ctx: NodeContext): void;
    compose(ctx: NodeContext, inputs: Readonly<Record<string, FrameBuffer>>, out: FrameBuffer, signal: Signal, inputMeta?: Readonly<Record<string, CompositorInputMeta>>): void;
    glsl?: string;
    destroy(): void;
}
export interface SignalSource {
    readonly type: 'signal';
    readonly id: string;
    readonly outputs: readonly string[];
    config: Record<string, unknown>;
    init(ctx: NodeContext): void;
    tick(signal: Signal): Record<string, number>;
    destroy(): void;
}
export type DemoNode = Generator | Modifier | Compositor | SignalSource;
export interface SceneNode {
    id: string;
    type: 'generator' | 'modifier' | 'compositor' | 'signal';
    impl: string;
    config: Record<string, AnimatableFloat | unknown>;
    resolution?: {
        width: number;
        height: number;
    };
    startTime?: number;
    endTime?: number;
}
export interface SceneEdge {
    from: {
        node: string;
        output: string;
    };
    to: {
        node: string;
        input: string;
    };
    z?: number;
    transform?: CompositorEdgeTransform;
}
export interface SceneGraph {
    nodes: SceneNode[];
    edges: SceneEdge[];
    outputs: Record<string, string>;
}
/** Extended set (improvement plan §3.1) — ship all names; some map to baseline until tuned. */
export type RocketInterpolation = 'step' | 'linear' | 'smooth' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'elastic' | 'bounce' | 'back' | 'expo-in' | 'expo-out';
export interface ClockOptions {
    /** Start timeline from this many seconds in. */
    seek?: number;
    /** Playback rate (0 = paused, 0.25 = quarter speed, 1 = normal). */
    rate?: number;
    /** Optional loop range in seconds. */
    loop?: [number, number];
}
export interface Clock {
    currentTime(): number;
    isPaused(): boolean;
    getRate(): number;
    seek(t: number): void;
    pause(): void;
    play(): void;
    setRate(rate: number): void;
}
export interface RocketKey {
    row: number;
    value: number;
    interpolation: RocketInterpolation;
}
export interface RocketTrack {
    name: string;
    keys: RocketKey[];
}
export interface Scene {
    id: string;
    title: string;
    duration: number;
    bpm: number;
    rowsPerBeat: number;
    audio?: AudioClip | string;
    resolution: {
        width: number;
        height: number;
    };
    fps: number;
    tracks: RocketTrack[];
    graph: SceneGraph;
}
export interface AudioClip {
    src: string;
    volume?: number;
    /** First-pass pitch control; currently maps to playback-rate style behavior. */
    pitch?: number;
}
export interface DemoTransition {
    type: 'cut' | 'dissolve' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'zoom-out' | 'flash' | 'iris' | 'blinds' | 'checker' | 'push' | 'melt';
    duration?: number;
    easing?: RocketInterpolation;
    flashColor?: string;
}
export interface DemoSection {
    id: string;
    scene: string;
    duration?: number;
    transition?: DemoTransition;
}
export interface DemoModifier {
    id: string;
    impl: string;
    enabled?: boolean;
    config: Record<string, AnimatableFloat | unknown>;
}
export interface Demo {
    id: string;
    title: string;
    audio?: AudioClip | string;
    loop?: boolean;
    modifiers?: DemoModifier[];
    sections: DemoSection[];
}
export interface Sink {
    readonly id: string;
    init(width: number, height: number, fps: number): Promise<void>;
    write(frame: FrameBuffer, frameIndex: number, signal: Signal): Promise<void>;
    flush(): Promise<void>;
}
export type TerminalMode = 'sixel' | 'ansi' | 'ascii';
export interface TerminalSinkOptions {
    mode?: TerminalMode;
    fpsCap?: number;
    fullscreen?: boolean;
    noDisplay?: boolean;
    /** Called when the terminal size may have changed (SIGWINCH / stdout resize). */
    onResize?: () => void;
}
/** Resolve a literal, Rocket track ref, or signal-node output ref to a number. */
export declare function resolveAnimatableFloat(v: AnimatableFloat | unknown, signal: Signal): number;
export interface CompositorOptions {
    renderer: 'cpu' | 'gpu';
}
//# sourceMappingURL=index.d.ts.map