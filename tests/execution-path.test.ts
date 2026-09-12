import { describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  FIELD_SEPARATOR,
  containerResultKey,
  decodePath,
  encodePath,
  exerciseResultKey,
  nodeKey
} from '../src/domain/execution-path';
import type { PathSegment } from '../src/domain/execution-path';

const SPEC_PATH: PathSegment[] = [
  { nodeId: 'root' },
  { nodeId: 'squat-sets', iteration: 3 },
  { nodeId: 'back-squat-set' }
];

describe('encodePath', () => {
  test('produces the spec example', () => {
    expect(encodePath(SPEC_PATH)).toBe('root/squat-sets:3/back-squat-set');
  });

  test('omits the iteration when a segment has none', () => {
    expect(encodePath([{ nodeId: 'root' }, { nodeId: 'warmup' }])).toBe('root/warmup');
  });

  test('rejects an empty path', () => {
    expect(() => encodePath([])).toThrow(AppError);
  });

  test('rejects a banned character in a node ID', () => {
    expect(() => encodePath([{ nodeId: 'a|b' }])).toThrow(AppError);
    expect(() => encodePath([{ nodeId: 'a:b' }])).toThrow(AppError);
    expect(() => encodePath([{ nodeId: 'a/b' }])).toThrow(AppError);
  });

  test('rejects an iteration below one', () => {
    expect(() => encodePath([{ nodeId: 'sets', iteration: 0 }])).toThrow(AppError);
    expect(() => encodePath([{ nodeId: 'sets', iteration: 1.5 }])).toThrow(AppError);
  });
});

describe('decodePath', () => {
  test('round-trips a nested repeated container', () => {
    const segments: PathSegment[] = [
      { nodeId: 'root' },
      { nodeId: 'circuit', iteration: 2 },
      { nodeId: 'complex', iteration: 4 },
      { nodeId: 'clean-press-set' }
    ];

    expect(decodePath(encodePath(segments))).toEqual(segments);
  });

  test('round-trips segments without iterations', () => {
    const segments: PathSegment[] = [{ nodeId: 'root' }, { nodeId: 'warmup' }];

    expect(decodePath(encodePath(segments))).toEqual(segments);
  });

  test('reads the iteration back as a number', () => {
    const [segment] = decodePath('root/squat-sets:3/back-squat-set');

    expect(segment).toEqual({ nodeId: 'root' });
    expect(decodePath('root/squat-sets:3/back-squat-set')[1]).toEqual({
      nodeId: 'squat-sets',
      iteration: 3
    });
  });

  test('rejects an empty encoded path', () => {
    expect(() => decodePath('')).toThrow(AppError);
  });

  test('rejects an empty node ID or a bad iteration', () => {
    expect(() => decodePath(':3')).toThrow(AppError);
    expect(() => decodePath('root/sets:x')).toThrow(AppError);
    expect(() => decodePath('root/sets:0')).toThrow(AppError);
  });
});

describe('exerciseResultKey', () => {
  test('matches the spec example at the defaults', () => {
    expect(exerciseResultKey(SPEC_PATH)).toBe('root/squat-sets:3/back-squat-set|both|1');
  });

  test('always emits both side and attempt', () => {
    for (const key of [
      exerciseResultKey(SPEC_PATH),
      exerciseResultKey(SPEC_PATH, 'both', 1),
      exerciseResultKey(SPEC_PATH, 'left', 2)
    ]) {
      expect(key.split(FIELD_SEPARATOR)).toHaveLength(3);
    }
  });

  test('emits every allowed side', () => {
    expect(exerciseResultKey([{ nodeId: 'set' }], 'alternating', 1)).toBe('set|alternating|1');
    expect(exerciseResultKey([{ nodeId: 'set' }], 'right', 3)).toBe('set|right|3');
  });

  test('rejects an unknown side or a bad attempt', () => {
    expect(() => exerciseResultKey([{ nodeId: 'set' }], 'sideways' as never)).toThrow(AppError);
    expect(() => exerciseResultKey([{ nodeId: 'set' }], 'both', 0)).toThrow(AppError);
  });
});

describe('containerResultKey', () => {
  test('uses the path and attempt shape', () => {
    expect(containerResultKey([{ nodeId: 'root' }, { nodeId: 'circuit', iteration: 2 }])).toBe(
      'root/circuit:2|1'
    );
    expect(containerResultKey([{ nodeId: 'circuit' }], 4)).toBe('circuit|4');
  });

  test('never carries a side field', () => {
    expect(containerResultKey([{ nodeId: 'circuit' }]).split(FIELD_SEPARATOR)).toHaveLength(2);
  });

  test('rejects a bad attempt', () => {
    expect(() => containerResultKey([{ nodeId: 'circuit' }], -1)).toThrow(AppError);
  });
});

describe('nodeKey', () => {
  test('joins the workout ID and the node ID', () => {
    expect(nodeKey('w', 'n')).toBe('w|n');
  });

  test('rejects a banned character in either part', () => {
    expect(() => nodeKey('w|1', 'n')).toThrow(AppError);
    expect(() => nodeKey('w', 'n:2')).toThrow(AppError);
  });
});
