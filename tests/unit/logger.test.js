import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, LOG_LEVELS } from '../../js/utils/logger.js';

describe('Logger', () => {
    let originalLevel;

    beforeEach(() => {
        originalLevel = logger.getLevel();
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logger.setLevel(originalLevel);
        vi.restoreAllMocks();
    });

    it('respects log level filters', () => {
        logger.setLevel(LOG_LEVELS.WARN);
        logger.debug('debug message');
        logger.info('info message');
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();

        logger.warn('warn message');
        expect(console.warn).toHaveBeenCalledWith('[TraewellingMaps:WARN]', 'warn message');

        logger.error('error message');
        expect(console.error).toHaveBeenCalledWith('[TraewellingMaps:ERROR]', 'error message');
    });

    it('silences all logs when level is SILENT', () => {
        logger.setLevel(LOG_LEVELS.SILENT);
        logger.debug('1');
        logger.info('2');
        logger.warn('3');
        logger.error('4');
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });
});
