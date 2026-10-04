// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  DaemonSessionSummary,
  DaemonWorkspaceMergeState,
} from '@qwen-code/sdk/daemon';
import {
  flushSidebar,
  installSidebarDomShims,
  makeSidebarSession as makeSession,
  resolveWebShellSessions,
} from '../../test/sidebarHarness';

const {
  connection,
  workspace,
  workspaceActions,
  workspaceQualified,
  active,
  pinned,
  archived,
} = vi.hoisted(() => {
  const qualified = {
    listWorkspaceSessions: vi.fn().mockResolvedValue([]),
    listSessionGroups: vi.fn().mockResolvedValue({ groups: [] }),
    workspaceGitMerge: vi.fn(),
  };
  const makeSessions = () => {
    const state = {
      sessions: [] as DaemonSessionSummary[],
      loading: false,
      error: null as Error | null,
      data: [] as DaemonSessionSummary[] | undefined,
      reload: vi.fn().mockResolvedValue(undefined),
    };
    state.data = state.sessions;
    return state;
  };
  return {
    connection: {
      status: 'connected',
      sessionId: null as string | null,
      workspaceCwd: '/tmp/project',
      capabilities: undefined,
    },
    workspace: {
      capabilities: undefined,
      client: {
        searchWorkspaceSessions: vi.fn().mockResolvedValue({ results: [] }),
        workspaceByCwd: vi.fn(() => qualified),
      },
      refreshCapabilities: vi.fn(),
    },
    workspaceQualified: qualified,
    workspaceActions: {
      addWorkspace: vi.fn(),
      removeWorkspace: vi.fn(),
      listSessionGroups: vi.fn().mockResolvedValue({ groups: [] }),
    },
    active: makeSessions(),
    pinned: makeSessions(),
    archived: makeSessions(),
  };
});

const loadSession = vi.hoisted(() => vi.fn());

vi.mock('@qwen-code/web-shell/daemon-react-sdk', () => ({
  DAEMON_APPROVAL_MODES: ['default', 'plan', 'auto-edit', 'auto', 'yolo'],
  useConnection: () => connection,
  useActions: () => ({ renameSession: vi.fn() }),
  useWorkspace: () => workspace,
  useWorkspaceActions: () => workspaceActions,
  useChannels: () => ({ data: undefined, catalog: [], channels: {} }),
  useSessions: (options?: { archiveState?: string; group?: string }) => {
    if (options?.archiveState === 'archived') return archived;
    if (options?.group === 'pinned') return pinned;
    return active;
  },
}));

vi.mock('../../session-catalog/session-catalog-hooks', () => ({
  useWebShellSessions: (options?: {
    enabled?: boolean;
    archiveState?: string;
    group?: string;
  }) => {
    const state =
      options?.archiveState === 'archived'
        ? archived
        : options?.group === 'pinned'
          ? pinned
          : active;
    return resolveWebShellSessions(state, options?.enabled !== false, {
      routeKind: 'legacy',
      workspaceCwd: connection.workspaceCwd,
      options,
    });
  },
  useSessionCatalogController: () => ({
    refreshQueries: vi.fn(),
    invalidateWorkspace: vi.fn(),
    refreshWorkspace: vi.fn(),
    renamed: vi.fn(),
    toggleSessionPinned: vi.fn(),
  }),
  useSessionCatalogPolling: () => undefined,
  useSessionCatalogQuery: () => ({
    sessions: [] as DaemonSessionSummary[],
    loading: false,
    error: undefined,
    reload: vi.fn().mockResolvedValue(undefined),
  }),
  useSessionCatalogQueries: () => [],
}));

const { I18nProvider } = await import('../../i18n');
const { WebShellSidebar } = await import('./WebShellSidebar');
const { resetMergeStates } = await import('./sessionMergeStates');

installSidebarDomShims();

let root: Root;
let container: HTMLDivElement;

function renderSidebar(): void {
  act(() => {
    root.render(
      <I18nProvider language="en">
        <WebShellSidebar
          collapsed={false}
          onCollapsedChange={() => {}}
          onOpenSettings={() => {}}
          onOpenDaemonStatus={() => {}}
          onOpenScheduledTasks={() => {}}
          onOpenGoals={() => {}}
          onOpenSessions={() => {}}
          onOpenSplitView={() => {}}
          onNewSession={() => false}
          onLoadSession={loadSession}
          onError={() => {}}
        />
      </I18nProvider>,
    );
  });
}

function mergeState(
  over: Partial<DaemonWorkspaceMergeState> &
    Pick<DaemonWorkspaceMergeState, 'kind'>,
): DaemonWorkspaceMergeState {
  return { ahead: 0, checkedAt: Date.now(), ...over };
}

function rowFor(displayName: string): HTMLElement {
  const title = Array.from(
    container.querySelectorAll('[data-web-shell-session-title]'),
  ).find((node) => node.textContent === displayName);
  expect(title, `no row titled ${displayName}`).toBeTruthy();
  let node: HTMLElement | null = title as HTMLElement;
  while (node && !node.className?.includes?.('sessionRow')) {
    node = node.parentElement;
  }
  expect(node, `no session row for ${displayName}`).toBeTruthy();
  return node as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  connection.sessionId = null;
  connection.workspaceCwd = '/tmp/project';
  active.sessions = [];
  active.data = active.sessions;
  pinned.sessions = [];
  pinned.data = pinned.sessions;
  archived.sessions = [];
  archived.data = archived.sessions;
  workspaceQualified.workspaceGitMerge.mockReset();
  resetMergeStates();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  resetMergeStates();
});

describe('WebShellSidebar merge-state glyph (variant B)', () => {
  it('leads the row with merge state then worktree icon, and leaves the right edge to the status cluster', async () => {
    workspaceQualified.workspaceGitMerge.mockResolvedValue(
      mergeState({ kind: 'unmerged', ahead: 3, baseRef: 'origin/skymain' }),
    );
    active.sessions = [
      makeSession('a', {
        displayName: 'Release vorbereiten',
        branch: { name: 'release/0.24.7' },
        worktree: {
          slug: 'wt',
          path: '/tmp/project/.qwen/worktrees/wt',
          branch: 'release/0.24.7',
        },
      }),
    ];
    renderSidebar();
    await act(async () => {
      await flushSidebar();
    });

    const row = rowFor('Release vorbereiten');
    const lead = row.querySelector('[data-web-shell-session-merge-state]');
    expect(lead).toBeTruthy();
    expect(lead?.getAttribute('data-web-shell-session-merge-state')).toBe(
      'unmerged',
    );
    expect(lead?.getAttribute('aria-label')).toContain('origin/skymain');

    // Variant B: the fork icon follows the merge glyph in the same lead group,
    // both ahead of the title.
    const leadGroup = lead?.parentElement;
    expect(
      leadGroup?.querySelector('[data-web-shell-session-git-icon]'),
    ).toBeTruthy();
    const children = Array.from(leadGroup?.children ?? []);
    const titleIndex = children.findIndex((child) =>
      child.querySelector?.('[data-web-shell-session-title]'),
    );
    expect(titleIndex).toBe(-1);
    expect(
      row.compareDocumentPosition(lead as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // …and the trailing slot carries no git icon any more.
    expect(row.querySelector('[class*="sessionGitIcon"]')).toBeNull();
  });

  it('probes once per distinct directory, not once per row', async () => {
    workspaceQualified.workspaceGitMerge.mockResolvedValue(
      mergeState({ kind: 'merged', baseRef: 'origin/skymain' }),
    );
    // Three sessions in one workspace, one of them in a worktree: two probes.
    active.sessions = [
      makeSession('a', { displayName: 'One', branch: { name: 'main' } }),
      makeSession('b', { displayName: 'Two', branch: { name: 'main' } }),
      makeSession('c', {
        displayName: 'Three',
        worktree: {
          slug: 'wt',
          path: '/tmp/project/.qwen/worktrees/wt',
          branch: 'wt',
        },
      }),
    ];
    renderSidebar();
    await act(async () => {
      await flushSidebar();
    });

    const cwds = workspaceQualified.workspaceGitMerge.mock.calls.map(
      (call) => call[0]?.cwd,
    );
    expect(cwds).toEqual(['/tmp/project', '/tmp/project/.qwen/worktrees/wt']);
  });

  it('probes nothing for a session outside any repository', async () => {
    active.sessions = [makeSession('a', { displayName: 'No git here' })];
    renderSidebar();
    await act(async () => {
      await flushSidebar();
    });

    expect(workspaceQualified.workspaceGitMerge).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-web-shell-session-merge-state]'),
    ).toBeNull();
  });

  it('keeps the row usable when the daemon has not answered yet', async () => {
    let resolveMerge: (state: DaemonWorkspaceMergeState) => void = () => {};
    workspaceQualified.workspaceGitMerge.mockReturnValue(
      new Promise<DaemonWorkspaceMergeState>((resolve) => {
        resolveMerge = resolve;
      }),
    );
    active.sessions = [
      makeSession('a', {
        displayName: 'Pending',
        worktree: {
          slug: 'wt',
          path: '/tmp/project/.qwen/worktrees/wt',
          branch: 'wt',
        },
      }),
    ];
    renderSidebar();
    await act(async () => {
      await flushSidebar();
    });

    // The fork icon is known from the session itself, so the row must not be
    // waiting on the probe to render it.
    const row = rowFor('Pending');
    expect(row.querySelector('[data-web-shell-session-git-icon]')).toBeTruthy();
    expect(
      row.querySelector('[data-web-shell-session-merge-state]'),
    ).toBeNull();

    await act(async () => {
      resolveMerge(mergeState({ kind: 'unmerged', ahead: 1 }));
      await flushSidebar();
    });
    expect(
      rowFor('Pending').querySelector('[data-web-shell-session-merge-state]'),
    ).toBeTruthy();
  });
});
