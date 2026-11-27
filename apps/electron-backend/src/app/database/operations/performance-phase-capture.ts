import type {
    PerformancePhaseMetadata,
    DatabaseWorkerPerformancePhase,
    XtreamDatabasePerformancePhase,
} from '@iptvnator/shared/interfaces';

export interface DatabaseOperationPerformancePhaseCapture<
    TPhase extends DatabaseWorkerPerformancePhase = XtreamDatabasePerformancePhase,
> {
    captureAsync: <TResult>(
        phase: TPhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: TPhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
}
