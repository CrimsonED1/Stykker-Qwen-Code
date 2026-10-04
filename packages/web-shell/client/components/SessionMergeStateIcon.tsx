/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MergeState } from '@qwen-code/qwen-code-core/utils/git-merge-state.js';
import {
  CircleSlashIcon,
  ClockIcon,
  GitBranchIcon,
  GitMergeIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import styles from './SessionMergeStateIcon.module.css';

/**
 * Six states, each with its own glyph AND its own color. The form carries the
 * meaning on its own because the sidebar has no hover on mobile, where a
 * color-only signal would be unreadable — and a colored dot or a hidden glyph
 * is ambiguous there: an empty slot looks like "not loaded yet".
 *
 * `not-a-repo` deliberately renders nothing. A session outside a repository
 * has no merge question to answer, and a placeholder glyph would claim
 * otherwise.
 */
const STATE_ICONS = {
  unmerged: { Icon: TriangleAlertIcon, className: styles.mergeStateUnmerged },
  merged: { Icon: GitMergeIcon, className: styles.mergeStateMerged },
  'on-main': { Icon: GitBranchIcon, className: styles.mergeStateOnMain },
  'no-remote': { Icon: CircleSlashIcon, className: styles.mergeStateNoRemote },
  unknown: { Icon: ClockIcon, className: styles.mergeStateStale },
  'not-a-repo': undefined,
} as const satisfies Record<
  MergeState['kind'],
  { Icon: typeof GitBranchIcon; className: string } | undefined
>;

/**
 * Merge state of a session's branch relative to its remote base, rendered as
 * the state glyph next to the existing worktree/branch icon.
 *
 * Reuses the SessionPrStateIcon color convention so both state icons read as
 * one family: accent for "done", warning for "attention", muted for "nothing to
 * do". Returns null outside a git repository.
 */
export function SessionMergeStateIcon({ state }: { state: MergeState }) {
  const entry = STATE_ICONS[state.kind];
  if (!entry) return null;
  const { Icon, className } = entry;
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * Localized tooltip text for assistive tech and the row popover. Returns
 * undefined for `not-a-repo`, which renders no glyph and so needs no label.
 *
 * The commit count and the check time are part of the text on purpose: a green
 * "merged" without them is a claim about a moment the user cannot see.
 */
export function sessionMergeStateLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  state: MergeState,
): string | undefined {
  switch (state.kind) {
    case 'unmerged':
      return t('sidebar.sessionMergeStateUnmerged', {
        count: state.ahead,
        base: state.baseRef ?? '',
      });
    case 'merged':
      return t('sidebar.sessionMergeStateMerged', {
        base: state.baseRef ?? '',
      });
    case 'on-main':
      return t('sidebar.sessionMergeStateOnMain', {
        branch: state.baseBranch ?? '',
      });
    case 'no-remote':
      return t('sidebar.sessionMergeStateNoRemote');
    case 'unknown':
      return t('sidebar.sessionMergeStateStale');
    default:
      return undefined;
  }
}
