/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { describe, expect, it } from 'vitest';
import { parseSamplePoints } from '../src/styles/samplePoints';

describe('gpx-map sample_points', () => {
    it('reads a list of points in the usual shapes', () => {
        expect(parseSamplePoints('[{"lat":46.9,"lon":7.4},{"lat":"47.0","lng":"7.5"},[47.1,7.6]]')).toEqual([
            [46.9, 7.4],
            [47, 7.5],
            [47.1, 7.6],
        ]);
    });

    it('reads a whole GPX answer of the survey', () => {
        expect(parseSamplePoints({ sampledPoints: [{ lat: 46.9, lon: 7.4, ele: 540 }], distanceMeters: 12 })).toEqual([[46.9, 7.4]]);
    });

    it('leaves out what is not a point and returns nothing for other values', () => {
        expect(parseSamplePoints('[{"lat":91,"lon":7},{"lat":46},null,"x",[1]]')).toEqual([]);
        expect(parseSamplePoints('not json')).toEqual([]);
        expect(parseSamplePoints('')).toEqual([]);
        expect(parseSamplePoints({ name: 'route' })).toEqual([]);
    });
});
