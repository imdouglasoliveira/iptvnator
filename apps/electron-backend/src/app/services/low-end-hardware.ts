import { cpus, totalmem } from 'os';

export const LOW_END_MAX_MEMORY_BYTES = 4.5 * 1024 ** 3;
export const LOW_END_MAX_CPU_CORES = 2;
export const LOW_END_HARDWARE_CHANNEL = 'LOW_END_HARDWARE';

export function isLowEndHardware(
    memoryBytes: number = totalmem(),
    cpuCores: number = cpus().length
): boolean {
    return (
        memoryBytes <= LOW_END_MAX_MEMORY_BYTES ||
        (cpuCores > 0 && cpuCores <= LOW_END_MAX_CPU_CORES)
    );
}
