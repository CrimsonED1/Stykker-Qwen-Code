// @vitest-environment jsdom

/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { MergeState } from '@qwen-code/qwen-code-core/utils/git-merge-state.js';
import {
  SessionMergeStateIcon,
  sessionMergeStateLabel,
} from './SessionMergeStateIcon.js';

vi.mock('./SessionMergeStateIcon.module.css', () => ({
  default: {
    mergeStateUnmerged: 'mergeStateUnmerged',
    mergeStateMerged: 'mergeStateMerged',
    mergeStateOnMain: 'mergeStateOnMain',
    mergeStateNoRemote: 'mergeStateNoRemote',
    mergeStateStale: 'mergeStateStale',
  },
}));

const state = (over: Partial<MergeState> & Pick<MergeState, 'kind'>) =>
  ({ ahead: 0, checkedAt: 0, ...over }) as MergeState;

describe('SessionMergeStateIcon', () => {
  it('renders a glyph for every state except not-a-repo', () => {
    const kinds = [
      'unmerged',
      'merged',
      'on-main',
      'no-remote',
      'unknown',
    ] as const;
    for (const kind of kinds) {
      const { container, unmount } = render(
        <SessionMergeStateIcon state={state({ kind })} />,
      );
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('renders nothing outside a git repository', () => {
    const { container } = render(
      <SessionMergeStateIcon state={state({ kind: 'not-a-repo' })} />,
    );
    // An empty slot in the sidebar would read as "not loaded yet".
    expect(container.querySelector('svg')).toBeNull();
  });

  it('gives unmerged and merged distinct glyphs', () => {
    const unmerged = render(
      <SessionMergeStateIcon state={state({ kind: 'unmerged', ahead: 3 })} />,
    ).container.querySelector('svg')?.innerHTML;
    const merged = render(
      <SessionMergeStateIcon state={state({ kind: 'merged' })} />,
    ).container.querySelector('svg')?.innerHTML;
    expect(unmerged).not.toEqual(merged);
  });

  it('does not paint an unfetched base green', () => {
    const { container } = render(
      <SessionMergeStateIcon state={state({ kind: 'unknown' })} />,
    );
    // lucide appends its own classes, so match the state class, not equality.
    const className = container.querySelector('svg')?.getAttribute('class');
    expect(className).toContain('mergeStateStale');
    expect(className).not.toContain('mergeStateMerged');
  });

  it('marks every glyph aria-hidden', () => {
    const { container } = render(
      <SessionMergeStateIcon state={state({ kind: 'unmerged' })} />,
    );
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});

describe('sessionMergeStateLabel', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    `${key}:${JSON.stringify(params ?? {})}`;

  it('names the commit count and the base ref for unmerged', () => {
    const label = sessionMergeStateLabel(
      t,
      state({
        kind: 'unmerged',
        ahead: 41,
        baseRef: 'origin/main',
        baseBranch: 'main',
      }),
    );
    expect(label).toContain('41');
    expect(label).toContain('origin/main');
  });

  it('has no label outside a repository', () => {
    expect(
      sessionMergeStateLabel(t, state({ kind: 'not-a-repo' })),
    ).toBeUndefined();
  });

  it('labels every state that renders a glyph', () => {
    for (const kind of [
      'unmerged',
      'merged',
      'on-main',
      'no-remote',
      'unknown',
    ] as const) {
      expect(sessionMergeStateLabel(t, state({ kind }))).toBeDefined();
    }
  });

  it('calls the unfetched case stale, never merged', () => {
    const label = sessionMergeStateLabel(t, state({ kind: 'unknown' }));
    expect(label).toContain('Stale');
    expect(label).not.toContain('Merged');
  });
});
