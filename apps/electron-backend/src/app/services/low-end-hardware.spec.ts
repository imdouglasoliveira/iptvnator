import { isLowEndHardware } from './low-end-hardware';

const GIB = 1024 ** 3;

describe('isLowEndHardware', () => {
    it('flags a 4 GB machine', () => {
        expect(isLowEndHardware(4 * GIB, 4)).toBe(true);
    });

    it('flags the 4.5 GB limit itself', () => {
        expect(isLowEndHardware(4.5 * GIB, 8)).toBe(true);
    });

    it('flags a two core machine with plenty of memory', () => {
        expect(isLowEndHardware(16 * GIB, 2)).toBe(true);
    });

    it('does not flag 8 GB and 4 cores', () => {
        expect(isLowEndHardware(8 * GIB, 4)).toBe(false);
    });

    it('does not flag memory just above the limit', () => {
        expect(isLowEndHardware(4.6 * GIB, 4)).toBe(false);
    });

    it('does not flag a machine whose core count is unknown', () => {
        expect(isLowEndHardware(8 * GIB, 0)).toBe(false);
    });
});
